// @agentgate/server — Agent identity registry (agent-identity spine).
//
// A verifiable, non-human principal. An agent is issued a public client id
// (`agt_*`) and a secret (`ags_*`, shown once); only sha256(secret) is stored.
// On a request the agent presents `X-Agent-Id` + `X-Agent-Secret`; we verify
// and stamp the resulting agents.id onto the approval request + audit trail.
//
// Kept distinct from api_keys (human/service keys) so agent identity and
// per-agent scoping/budgets (virtual keys, Tier-3) stay cleanly separable.
// ponytail: per-request secret verification mirrors the existing api-key model;
// an OAuth2 client-credentials token exchange (short-lived JWT) is the natural
// next step to avoid sending the long-lived secret on every call.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { agents } from "../db/schema.js";

export type Agent = typeof agents.$inferSelect;
/** Secret-free view of an agent, safe to return from the API. */
export type PublicAgent = Omit<Agent, "secretHash" | "ingestKeyHash">;

export function hashAgentSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Generate a fresh agent client id + secret (the secret is shown once). */
export function generateAgentCredential(): { id: string; secret: string } {
  return {
    id: `agt_${nanoid()}`,
    secret: `ags_${randomBytes(32).toString("base64url")}`,
  };
}

function toPublic(a: Agent): PublicAgent {
  const copy: Partial<Agent> = { ...a };
  delete copy.secretHash;
  delete copy.ingestKeyHash;
  return copy as PublicAgent;
}

/** Register a new agent. Returns the public record + the one-time secret. */
export async function createAgent(
  name: string,
  metadata?: Record<string, unknown> | null,
  monthlyBudgetUsd?: number | null,
): Promise<{ agent: PublicAgent; secret: string }> {
  const { id, secret } = generateAgentCredential();
  const now = new Date();
  const values = {
    id,
    name,
    secretHash: hashAgentSecret(secret),
    status: "active" as const,
    metadata: metadata ? JSON.stringify(metadata) : null,
    createdAt: now,
    lastSeenAt: null,
    revokedAt: null,
    monthlyBudgetUsd: monthlyBudgetUsd ?? null,
    ingestKeyHash: null,
  };
  await getDb().insert(agents).values(values);
  return { agent: toPublic(values), secret };
}

/** The agent's monthly USD budget cap, or null if it has none / doesn't exist. */
export async function getAgentBudget(id: string): Promise<number | null> {
  const rows = await getDb()
    .select({ monthlyBudgetUsd: agents.monthlyBudgetUsd })
    .from(agents)
    .where(eq(agents.id, id))
    .limit(1);
  return rows[0]?.monthlyBudgetUsd ?? null;
}

/** Set or clear an agent's monthly USD budget. Returns false if missing. */
export async function setAgentBudget(id: string, monthlyBudgetUsd: number | null): Promise<boolean> {
  const rows = await getDb().select({ id: agents.id }).from(agents).where(eq(agents.id, id)).limit(1);
  if (!rows[0]) return false;
  await getDb().update(agents).set({ monthlyBudgetUsd }).where(eq(agents.id, id));
  return true;
}

/**
 * Verify an agent credential. Returns the agent iff it is active and the secret
 * matches; otherwise null. Compares fixed-length hex hashes in constant time.
 */
export async function verifyAgentCredential(
  id: string | undefined,
  secret: string | undefined,
): Promise<Agent | null> {
  if (!id || !secret) return null;
  const rows = await getDb()
    .select()
    .from(agents)
    .where(and(eq(agents.id, id), isNull(agents.revokedAt)))
    .limit(1);
  const agent = rows[0];
  if (!agent || agent.status !== "active") return null;

  const presented = Buffer.from(hashAgentSecret(secret), "hex");
  const stored = Buffer.from(agent.secretHash, "hex");
  if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) {
    return null;
  }

  // Best-effort liveness stamp; never block verification on it.
  try {
    await getDb().update(agents).set({ lastSeenAt: new Date() }).where(eq(agents.id, id));
  } catch {
    /* ignore */
  }
  return agent;
}

// ─── Ingest keys (#24) ──────────────────────────────────────────────
// A longer-lived, revocable, ingest-SCOPED credential for OTLP exporters that
// can't refresh a 15-min agent token. Distinct prefix + a separate hash column
// so an ingest key can never be presented as the agent secret (no gate auth).
// Only sha256(key) is stored; the plaintext is shown once at issuance.

/** Generate a fresh ingest key (shown once). */
export function generateIngestKey(): string {
  return `agl_ingest_${randomBytes(32).toString("base64url")}`;
}

/**
 * Issue or rotate an agent's ingest key. Generates a new key, stores only its
 * sha256 (overwriting any previous one — instantly invalidating the old key),
 * and returns the plaintext ONCE. Returns null if the agent is missing/revoked.
 */
export async function rotateIngestKey(id: string): Promise<string | null> {
  const rows = await getDb()
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, id), isNull(agents.revokedAt)))
    .limit(1);
  if (!rows[0]) return null;
  const key = generateIngestKey();
  await getDb().update(agents).set({ ingestKeyHash: hashAgentSecret(key) }).where(eq(agents.id, id));
  return key;
}

/** Revoke an agent's ingest key (clears the stored hash). Returns false if the agent is missing. */
export async function revokeIngestKey(id: string): Promise<boolean> {
  const rows = await getDb().select({ id: agents.id }).from(agents).where(eq(agents.id, id)).limit(1);
  if (!rows[0]) return false;
  await getDb().update(agents).set({ ingestKeyHash: null }).where(eq(agents.id, id));
  return true;
}

/**
 * Resolve the agent id for a presented ingest key, iff it matches an ACTIVE
 * (non-revoked) agent's stored hash; otherwise null. Lookup is by the
 * deterministic sha256 of the high-entropy key, so a rotated/revoked key no
 * longer matches. This is what AgentLens calls (via the internal verify route)
 * to attribute an OTLP span — revocation takes effect immediately, bounded only
 * by AgentLens's short verify cache.
 */
export async function resolveAgentByIngestKey(key: string | undefined): Promise<string | null> {
  if (!key) return null;
  const rows = await getDb()
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.ingestKeyHash, hashAgentSecret(key)),
        eq(agents.status, "active"),
        isNull(agents.revokedAt),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function listAgents(): Promise<PublicAgent[]> {
  const rows = await getDb().select().from(agents);
  return rows.map(toPublic);
}

/**
 * Active-status check by id only (no secret). Used to re-validate an agent
 * Bearer token at USE time, since a stateless JWT can outlive a revoke.
 * Returns the id iff the agent still exists and is active; otherwise null.
 */
export async function getAgentIfActive(id: string): Promise<string | null> {
  const rows = await getDb()
    .select({ id: agents.id, status: agents.status })
    .from(agents)
    .where(and(eq(agents.id, id), isNull(agents.revokedAt)))
    .limit(1);
  return rows[0]?.status === "active" ? rows[0].id : null;
}

/** Revoke an agent. Returns false if it doesn't exist or is already revoked. */
export async function revokeAgent(id: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, id), isNull(agents.revokedAt)))
    .limit(1);
  if (!rows[0]) return false;
  await getDb()
    .update(agents)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(eq(agents.id, id));
  return true;
}
