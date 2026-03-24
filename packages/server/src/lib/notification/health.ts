/**
 * Channel Health Tracker
 *
 * Tracks per-channel health metrics in memory with circuit breaker logic.
 * Used by the dispatcher to detect unhealthy channels and trigger failover.
 */

import { getLogger } from "../logger.js";

// ============================================================================
// Types
// ============================================================================

export type ChannelStatus = "healthy" | "degraded" | "down";

export interface ChannelHealth {
  type: string;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  status: ChannelStatus;
}

// ============================================================================
// Constants
// ============================================================================

/** Channel is degraded after this many consecutive failures */
const DEGRADED_THRESHOLD = 3;

/** Channel is down after this many consecutive failures */
const DOWN_THRESHOLD = 5;

/** Channel is considered unhealthy if no success within this window (ms) */
const SUCCESS_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// ChannelHealthTracker
// ============================================================================

export class ChannelHealthTracker {
  private channels: Map<string, ChannelHealth> = new Map();

  /**
   * Get or initialize health record for a channel type
   */
  private getOrCreate(channelType: string): ChannelHealth {
    let health = this.channels.get(channelType);
    if (!health) {
      health = {
        type: channelType,
        successCount: 0,
        failureCount: 0,
        consecutiveFailures: 0,
        lastSuccessAt: null,
        lastFailureAt: null,
        status: "healthy",
      };
      this.channels.set(channelType, health);
    }
    return health;
  }

  /**
   * Derive status from consecutive failure count
   */
  private deriveStatus(consecutiveFailures: number): ChannelStatus {
    if (consecutiveFailures >= DOWN_THRESHOLD) return "down";
    if (consecutiveFailures >= DEGRADED_THRESHOLD) return "degraded";
    return "healthy";
  }

  /**
   * Record a successful send for a channel
   */
  recordSuccess(channelType: string): void {
    const health = this.getOrCreate(channelType);
    health.successCount++;
    health.consecutiveFailures = 0;
    health.lastSuccessAt = Date.now();
    health.status = "healthy";
  }

  /**
   * Record a failed send for a channel
   */
  recordFailure(channelType: string): void {
    const health = this.getOrCreate(channelType);
    health.failureCount++;
    health.consecutiveFailures++;
    health.lastFailureAt = Date.now();
    const newStatus = this.deriveStatus(health.consecutiveFailures);

    if (newStatus !== health.status) {
      getLogger().warn(
        `[ChannelHealth] Channel "${channelType}" status changed: ${health.status} -> ${newStatus} (${health.consecutiveFailures} consecutive failures)`
      );
    }

    health.status = newStatus;
  }

  /**
   * Check whether a channel is healthy enough to attempt sending.
   * Returns false if consecutiveFailures > 3 or no success in last 5 minutes
   * (when there has been at least one failure).
   */
  isHealthy(channelType: string): boolean {
    const health = this.channels.get(channelType);

    // Unknown channels are assumed healthy (first use)
    if (!health) return true;

    // Down channels are definitely unhealthy
    if (health.consecutiveFailures > DEGRADED_THRESHOLD) return false;

    // If there have been failures and no recent success, consider unhealthy
    if (health.failureCount > 0 && health.lastSuccessAt !== null) {
      const elapsed = Date.now() - health.lastSuccessAt;
      if (elapsed > SUCCESS_WINDOW_MS) return false;
    }

    // If there have been failures but never a success, check if we've had recent failures
    if (health.failureCount > 0 && health.lastSuccessAt === null) {
      if (health.consecutiveFailures > DEGRADED_THRESHOLD) return false;
    }

    return true;
  }

  /**
   * Get health data for all tracked channels
   */
  getHealth(): Map<string, ChannelHealth> {
    return new Map(this.channels);
  }

  /**
   * Get health data as a plain object (for API responses)
   */
  getHealthRecord(): Record<string, ChannelHealth> {
    const record: Record<string, ChannelHealth> = {};
    for (const [key, value] of this.channels) {
      record[key] = { ...value };
    }
    return record;
  }

  /**
   * Reset health data for a specific channel (e.g., after manual test)
   */
  resetChannel(channelType: string): void {
    this.channels.delete(channelType);
  }

  /**
   * Reset all health data
   */
  reset(): void {
    this.channels.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _tracker: ChannelHealthTracker | null = null;

/**
 * Get the global health tracker instance
 */
export function getHealthTracker(): ChannelHealthTracker {
  if (!_tracker) {
    _tracker = new ChannelHealthTracker();
  }
  return _tracker;
}

/**
 * Reset the global health tracker (for testing)
 */
export function resetHealthTracker(): void {
  _tracker = null;
}
