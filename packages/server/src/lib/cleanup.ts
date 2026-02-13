/**
 * Background cleanup job for expired tokens and stale webhook deliveries.
 *
 * CI-005: Periodically deletes decision tokens that have expired beyond the
 * retention window, and webhook deliveries whose parent webhook no longer exists.
 */

import { lt, sql } from "drizzle-orm";
import { getDb, decisionTokens, webhookDeliveries } from "../db/index.js";
import { getConfig } from "../config.js";
import { getLogger } from "./logger.js";

let cleanupTimer: NodeJS.Timeout | null = null;

/**
 * Run a single cleanup pass.
 * 1. Delete expired decision tokens older than retention window.
 * 2. Delete webhook deliveries for webhooks that no longer exist.
 */
export async function runCleanup(): Promise<{ deletedTokens: number; deletedDeliveries: number }> {
  const config = getConfig();
  const db = getDb();
  const log = getLogger();

  const retentionMs = config.cleanupRetentionDays * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - retentionMs);

  // 1. Delete expired decision tokens older than retention
  const tokenResult = await db
    .delete(decisionTokens)
    .where(lt(decisionTokens.expiresAt, cutoff));

  // drizzle returns { changes } for sqlite, { rowCount } for pg
  const deletedTokens = (tokenResult as any).changes ?? (tokenResult as any).rowCount ?? 0;

  // 2. Delete orphaned webhook deliveries (webhook no longer exists)
  const delResult = await db
    .delete(webhookDeliveries)
    .where(sql`${webhookDeliveries.webhookId} NOT IN (SELECT id FROM webhooks)`);
  const deletedDeliveries = (delResult as any).changes ?? (delResult as any).rowCount ?? 0;

  log.info({ deletedTokens, deletedDeliveries }, "Cleanup pass completed");
  return { deletedTokens, deletedDeliveries };
}

/**
 * Start the periodic cleanup job.
 */
export function startCleanup(): NodeJS.Timeout {
  const config = getConfig();
  cleanupTimer = setInterval(() => {
    runCleanup().catch(err => getLogger().error({ err }, "Cleanup job failed"));
  }, config.cleanupIntervalMs);
  return cleanupTimer;
}

/**
 * Stop the periodic cleanup job.
 */
export function stopCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
