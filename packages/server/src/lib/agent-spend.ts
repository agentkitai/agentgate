// @agentgate/server — Per-agent spend reads from AgentLens (#13).
//
// AgentGate doesn't observe LLM tokens itself; it reads priced per-agent spend
// from AgentLens' POST /api/internal/spend (authenticated by the shared
// AGENTGATE_SERVICE_TOKEN). Results are cached briefly so a burst of budget
// checks doesn't hammer AgentLens. This is the read side; budget enforcement
// (checkAgentBudget) builds on it.

import { AgentGateHttpClient } from "@agentgate/core";
import { getConfig } from "../config.js";
import { getLogger } from "./logger.js";

/** Thrown when AGENTLENS_URL / AGENTGATE_SERVICE_TOKEN are not configured. */
export class SpendNotConfiguredError extends Error {
  constructor() {
    super("Spend tracking not configured (set AGENTLENS_URL and AGENTGATE_SERVICE_TOKEN)");
    this.name = "SpendNotConfiguredError";
  }
}

export interface SpendWindow {
  from: string;
  to: string;
}

interface SpendRow {
  agentId: string;
  totalCostUsd: number;
  lastEventAt: string | null;
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { rows: SpendRow[]; at: number }>();

/** Clear the spend cache (testing). */
export function clearSpendCache(): void {
  cache.clear();
}

/** The current calendar-month window in UTC: [1st 00:00:00, now]. */
export function currentMonthWindow(now = new Date()): SpendWindow {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  return { from, to: now.toISOString() };
}

function toSpendMap(rows: SpendRow[], agentIds: string[]): Map<string, number> {
  // Agents AgentLens didn't return have no spend → default to 0.
  const m = new Map<string, number>(agentIds.map((id) => [id, 0]));
  for (const r of rows) m.set(r.agentId, Number(r.totalCostUsd) || 0);
  return m;
}

/**
 * Fetch per-agent USD spend over a window (default: current month), keyed on the
 * verified agent ids. Returns a map agentId → spend (0 for agents with none).
 * Served from cache when an entry is younger than `maxAgeMs` (default
 * {@link CACHE_TTL_MS}); pass a smaller value to bound staleness near a budget
 * cap. Throws SpendNotConfiguredError when AgentLens isn't configured;
 * propagates upstream/network errors to the caller.
 */
export async function fetchAgentSpend(
  agentIds: string[],
  tenantId: string,
  window?: SpendWindow,
  maxAgeMs = CACHE_TTL_MS,
): Promise<Map<string, number>> {
  const config = getConfig();
  if (!config.agentlensUrl || !config.agentgateServiceToken) {
    throw new SpendNotConfiguredError();
  }
  if (agentIds.length === 0) return new Map();

  const w = window ?? currentMonthWindow();
  // Quantize the window END into a CACHE_TTL_MS bucket so reads seconds apart
  // share a key (the raw `to` is ~now at ms precision, which would otherwise make
  // every call a cache miss). `from` keeps distinct periods separate.
  const toBucket = Math.floor(Date.parse(w.to) / CACHE_TTL_MS);
  const key = `${tenantId}|${w.from}|${toBucket}|${[...agentIds].sort().join(",")}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < maxAgeMs) {
    return toSpendMap(hit.rows, agentIds);
  }

  const client = new AgentGateHttpClient(
    config.agentlensUrl,
    config.agentgateServiceToken,
    config.spendReadTimeoutMs,
  );
  const res = await client.request<{ spend: SpendRow[] }>("POST", "/api/internal/spend", {
    agentIds,
    tenantId,
    from: w.from,
    to: w.to,
  });
  const rows = Array.isArray(res?.spend) ? res.spend : [];
  cache.set(key, { rows, at: now });
  getLogger().debug(
    { agentCount: agentIds.length, returned: rows.length, tenantId },
    "fetched agent spend from AgentLens",
  );
  return toSpendMap(rows, agentIds);
}
