/**
 * PERF-002: In-process policy cache
 *
 * Caches the parsed, priority-sorted policy list after the first DB load.
 * Invalidated immediately on any policy CRUD operation (same process).
 */

import { getDb, policies } from "../db/index.js";
import type { Policy as CorePolicy, PolicyRule } from "@agentgate/core";

let cachedPolicies: CorePolicy[] | null = null;
let inflight: Promise<CorePolicy[]> | null = null;

/**
 * Returns the cached policy list, loading from DB on first call (or after invalidation).
 * Policies are parsed and sorted by priority (ascending).
 * Uses promise coalescing to avoid duplicate DB loads on concurrent cache misses.
 */
export async function getCachedPolicies(): Promise<CorePolicy[]> {
  if (cachedPolicies !== null) {
    return cachedPolicies;
  }

  if (inflight) {
    return inflight;
  }

  inflight = (async () => {
    const rows = await getDb().select().from(policies).orderBy(policies.priority);

    cachedPolicies = rows.reduce<CorePolicy[]>((acc, p) => {
      try {
        acc.push({
          id: p.id,
          name: p.name,
          rules: JSON.parse(p.rules) as PolicyRule[],
          priority: p.priority,
          enabled: p.enabled,
        });
      } catch (err) {
        console.warn(`Skipping policy ${p.id} — malformed rules JSON:`, err);
      }
      return acc;
    }, []);

    return cachedPolicies;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

/**
 * Invalidates the policy cache. Next call to getCachedPolicies() will reload from DB.
 */
export function invalidatePolicyCache(): void {
  cachedPolicies = null;
}
