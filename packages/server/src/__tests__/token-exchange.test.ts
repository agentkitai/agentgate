/**
 * RFC-8693 token exchange — delegated agent tokens (#43, Tier 1).
 *
 * Covers the pure claim/chain builder, the RS256 mint + verify round-trip, the
 * load-bearing extraction (a delegated token is enforced against the ACTOR, not
 * the on-behalf-of principal), and the grant at POST /api/agents/token incl. its
 * fail-closed cases (disabled, missing actor_token, invalid tokens, revoked actor).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { generateKeyPair, exportPKCS8, decodeJwt } from "jose";
import { type AuthConfig } from "@agentkitai/auth";
import * as schema from "../db/schema.js";

// agent-tokens.ts → agents.js → db/index.js at import time; give it a real in-memory DB.
const sqlite = new Database(":memory:");
const db = drizzle(sqlite, { schema });

sqlite.exec(`
CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  secret_hash text NOT NULL,
  status text NOT NULL,
  metadata text,
  created_at integer NOT NULL,
  last_seen_at integer,
  revoked_at integer,
  monthly_budget_usd real,
  ingest_key_hash text
);
`);

vi.mock("../db/index.js", () => ({ getDb: () => db }));

import {
  signAgentToken,
  verifyAgentToken,
  verifyAgentTokenClaims,
  actingAgentOf,
  onBehalfOfAgent,
} from "../lib/agent-tokens.js";
import {
  buildDelegatedClaims,
  delegationDepth,
  mintDelegatedToken,
  MAX_DELEGATION_DEPTH,
} from "../lib/token-exchange.js";
import { createAgent, revokeAgent } from "../lib/agents.js";
import { __resetAgentTokenKeysCache } from "../lib/agent-token-keys.js";
import agentTokensRouter from "../routes/agent-tokens.js";
import { parseConfig, setConfig, resetConfig } from "../config.js";

const TEST_SECRET = "test-jwt-secret-at-least-32-chars-long!!";

function authConfig(): AuthConfig {
  return {
    oidc: null,
    jwt: { secret: TEST_SECRET, accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 604800 },
    authDisabled: false,
  };
}

let SIGNING_PEM: string;

/** Configure RS256 signing + the exchange flag, clearing the key cache. */
function configure(overrides: Record<string, unknown> = {}) {
  setConfig(
    parseConfig({
      jwtSecret: TEST_SECRET,
      agentTokenSigningKey: SIGNING_PEM,
      agentTokenExchangeEnabled: true,
      ...overrides,
    }),
  );
  __resetAgentTokenKeysCache();
}

beforeEach(async () => {
  if (!SIGNING_PEM) {
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    SIGNING_PEM = await exportPKCS8(privateKey);
  }
  sqlite.exec("DELETE FROM agents");
  configure();
});

afterAll(() => {
  resetConfig();
  __resetAgentTokenKeysCache();
  sqlite.close();
});

// ─── pure claim/chain builder ────────────────────────────────────────

describe("buildDelegatedClaims + delegationDepth", () => {
  it("simple delegation: sub = principal, act.sub = actor", () => {
    const built = buildDelegatedClaims({ sub: "agt_A" }, { sub: "agt_B" });
    expect(built).toEqual({ sub: "agt_A", act: { sub: "agt_B" } });
  });

  it("chains: preserves the ORIGINAL principal in sub, nests prior actors", () => {
    // subject_token already delegated (X's token, currently acting as A)…
    const subject = { sub: "agt_X", act: { sub: "agt_A" } };
    // …now A delegates to B.
    const built = buildDelegatedClaims(subject, { sub: "agt_B" });
    expect(built).toEqual({ sub: "agt_X", act: { sub: "agt_B", act: { sub: "agt_A" } } });
    expect(delegationDepth(built!.act)).toBe(2);
  });

  it("uses the actor's ACTING agent when the actor_token is itself delegated", () => {
    const built = buildDelegatedClaims({ sub: "agt_A" }, { sub: "agt_P", act: { sub: "agt_B" } });
    expect(built!.act.sub).toBe("agt_B"); // act.sub, not sub
  });

  it("rejects a chain deeper than the cap", () => {
    let subject: { sub: string; act?: unknown } = { sub: "agt_root" };
    for (let i = 0; i < MAX_DELEGATION_DEPTH; i++) {
      subject = buildDelegatedClaims(subject as never, { sub: `agt_${i}` })!;
    }
    // One more would exceed the cap.
    expect(buildDelegatedClaims(subject as never, { sub: "agt_last" })).toBeNull();
  });
});

describe("actingAgentOf / onBehalfOfAgent", () => {
  it("plain token: actor = sub, onBehalfOf = undefined", () => {
    expect(actingAgentOf({ sub: "agt_A" })).toBe("agt_A");
    expect(onBehalfOfAgent({ sub: "agt_A" })).toBeUndefined();
  });
  it("delegated token: actor = act.sub, onBehalfOf = sub", () => {
    const c = { sub: "agt_A", act: { sub: "agt_B" } };
    expect(actingAgentOf(c)).toBe("agt_B");
    expect(onBehalfOfAgent(c)).toBe("agt_A");
  });
});

// ─── mint + verify round-trip ────────────────────────────────────────

describe("mintDelegatedToken + verify", () => {
  it("mints an RS256 delegated token that verifies to the ACTOR (enforcement) + carries the principal", async () => {
    const token = await mintDelegatedToken({
      subjectClaims: { sub: "agt_A" },
      actorClaims: { sub: "agt_B" },
      config: authConfig(),
    });
    expect(token).toBeTruthy();

    // verifyAgentToken returns the ACTING agent → all enforcement targets B.
    expect(await verifyAgentToken(token!, authConfig())).toBe("agt_B");

    const claims = await verifyAgentTokenClaims(token!, authConfig());
    expect(actingAgentOf(claims!)).toBe("agt_B");
    expect(onBehalfOfAgent(claims!)).toBe("agt_A");
    expect(decodeJwt(token!)["typ"]).toBe("agent"); // discriminator preserved
  });

  it("returns null (delegation disabled) when no RS256 signing key is configured", async () => {
    configure({ agentTokenSigningKey: undefined });
    const token = await mintDelegatedToken({
      subjectClaims: { sub: "agt_A" },
      actorClaims: { sub: "agt_B" },
      config: authConfig(),
    });
    expect(token).toBeNull();
  });

  it("a plain (non-delegated) token still verifies to sub — backward compatible", async () => {
    const plain = await signAgentToken("agt_solo", authConfig());
    expect(await verifyAgentToken(plain, authConfig())).toBe("agt_solo");
    const claims = await verifyAgentTokenClaims(plain, authConfig());
    expect(onBehalfOfAgent(claims!)).toBeUndefined();
  });
});

// ─── the grant at POST /api/agents/token ─────────────────────────────

function tokenApp() {
  const app = new Hono();
  app.route("/", agentTokensRouter);
  return app;
}

async function post(app: Hono, body: Record<string, unknown>) {
  const res = await app.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

const EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange";

describe("POST /api/agents/token — token-exchange grant", () => {
  it("exchanges subject + actor tokens for a delegated token (actor acts for subject)", async () => {
    const a = await createAgent("subject-A");
    const b = await createAgent("actor-B");
    const subjectToken = await signAgentToken(a.agent.id, authConfig());
    const actorToken = await signAgentToken(b.agent.id, authConfig());

    const { status, body } = await post(tokenApp(), {
      grant_type: EXCHANGE,
      subject_token: subjectToken,
      actor_token: actorToken,
    });

    expect(status).toBe(200);
    expect(body["token_type"]).toBe("Bearer");
    expect(body["issued_token_type"]).toBe("urn:ietf:params:oauth:token-type:jwt");
    const claims = await verifyAgentTokenClaims(body["access_token"] as string, authConfig());
    expect(actingAgentOf(claims!)).toBe(b.agent.id); // enforced as the actor
    expect(onBehalfOfAgent(claims!)).toBe(a.agent.id); // on behalf of the subject
  });

  it("rejects when the grant is disabled (unsupported_grant_type)", async () => {
    configure({ agentTokenExchangeEnabled: false });
    const a = await createAgent("A");
    const b = await createAgent("B");
    const { status, body } = await post(tokenApp(), {
      grant_type: EXCHANGE,
      subject_token: await signAgentToken(a.agent.id, authConfig()),
      actor_token: await signAgentToken(b.agent.id, authConfig()),
    });
    expect(status).toBe(400);
    expect(body["error"]).toBe("unsupported_grant_type");
  });

  it("requires both subject_token and actor_token (no impersonation)", async () => {
    const a = await createAgent("A");
    const { status, body } = await post(tokenApp(), {
      grant_type: EXCHANGE,
      subject_token: await signAgentToken(a.agent.id, authConfig()),
      // actor_token omitted
    });
    expect(status).toBe(400);
    expect(body["error"]).toBe("invalid_request");
  });

  it("rejects a forged/invalid token (invalid_grant)", async () => {
    const a = await createAgent("A");
    const { status, body } = await post(tokenApp(), {
      grant_type: EXCHANGE,
      subject_token: await signAgentToken(a.agent.id, authConfig()),
      actor_token: "not.a.jwt",
    });
    expect(status).toBe(400);
    expect(body["error"]).toBe("invalid_grant");
  });

  it("rejects when the actor is a revoked agent (invalid_grant)", async () => {
    const a = await createAgent("A");
    const b = await createAgent("B");
    const subjectToken = await signAgentToken(a.agent.id, authConfig());
    const actorToken = await signAgentToken(b.agent.id, authConfig());
    await revokeAgent(b.agent.id);

    const { status, body } = await post(tokenApp(), {
      grant_type: EXCHANGE,
      subject_token: subjectToken,
      actor_token: actorToken,
    });
    expect(status).toBe(400);
    expect(body["error"]).toBe("invalid_grant");
  });

  it("plain client_credentials still works (unchanged)", async () => {
    const a = await createAgent("A");
    const { status, body } = await post(tokenApp(), {
      grant_type: "client_credentials",
      client_id: a.agent.id,
      client_secret: a.secret,
    });
    expect(status).toBe(200);
    expect(body["token_type"]).toBe("Bearer");
    expect(body["access_token"]).toBeTruthy();
  });
});
