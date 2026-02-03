/**
 * Type-safe EventEmitter for AgentGate events
 *
 * Provides a simple pub/sub mechanism for request lifecycle events.
 * Events are defined in events.ts and typed for compile-time safety.
 */

import type { AgentGateEvent, EventName } from "./events.js";

/**
 * Event listener callback type
 */
export type EventListener<T extends AgentGateEvent = AgentGateEvent> = (
  event: T
) => void | Promise<void>;

/**
 * Listener entry with optional once flag
 */
interface ListenerEntry {
  listener: EventListener;
  once: boolean;
}

/**
 * Type-safe EventEmitter for AgentGate
 *
 * Features:
 * - Strongly typed events matching AgentGateEvent union
 * - Support for one-time listeners (once)
 * - Async listener support
 * - Wildcard listeners for all events
 */
export class AgentGateEmitter {
  private listeners: Map<EventName | "*", ListenerEntry[]> = new Map();

  /**
   * Subscribe to events of a specific type
   */
  on<T extends AgentGateEvent["type"]>(
    eventType: T,
    listener: EventListener<Extract<AgentGateEvent, { type: T }>>
  ): () => void {
    return this.addListener(eventType, listener as EventListener, false);
  }

  /**
   * Subscribe to all events
   */
  onAll(listener: EventListener<AgentGateEvent>): () => void {
    return this.addListener("*", listener, false);
  }

  /**
   * Subscribe to an event once (auto-unsubscribe after first emit)
   */
  once<T extends AgentGateEvent["type"]>(
    eventType: T,
    listener: EventListener<Extract<AgentGateEvent, { type: T }>>
  ): () => void {
    return this.addListener(eventType, listener as EventListener, true);
  }

  /**
   * Unsubscribe from an event
   */
  off<T extends AgentGateEvent["type"]>(
    eventType: T,
    listener: EventListener<Extract<AgentGateEvent, { type: T }>>
  ): void {
    this.removeListener(eventType, listener as EventListener);
  }

  /**
   * Unsubscribe from all events
   */
  offAll(listener: EventListener<AgentGateEvent>): void {
    this.removeListener("*", listener);
  }

  /**
   * Emit an event to all subscribed listeners
   *
   * Listeners are called in order of subscription.
   * Errors in listeners are caught and logged but don't stop other listeners.
   */
  async emit<T extends AgentGateEvent>(event: T): Promise<void> {
    const eventType = event.type as EventName;

    // Get specific listeners for this event type
    const specificListeners = this.listeners.get(eventType) || [];
    // Get wildcard listeners
    const wildcardListeners = this.listeners.get("*") || [];

    // Combine both sets of listeners
    const allListeners = [...specificListeners, ...wildcardListeners];

    // Track once listeners to remove after emission
    const toRemove: Array<{ type: EventName | "*"; listener: EventListener }> =
      [];

    for (const entry of allListeners) {
      if (entry.once) {
        // Determine if this is from specific or wildcard
        const listenerType = specificListeners.includes(entry)
          ? eventType
          : "*";
        toRemove.push({ type: listenerType, listener: entry.listener });
      }

      try {
        await entry.listener(event);
      } catch (error) {
        // Log but don't throw - other listeners should still run
        console.error(
          `[AgentGateEmitter] Error in listener for ${event.type}:`,
          error
        );
      }
    }

    // Remove once listeners
    for (const { type, listener } of toRemove) {
      this.removeListener(type, listener);
    }
  }

  /**
   * Synchronously emit an event (fire-and-forget)
   *
   * Use this when you don't want to wait for async listeners.
   */
  emitSync<T extends AgentGateEvent>(event: T): void {
    void this.emit(event);
  }

  /**
   * Get the number of listeners for an event type
   */
  listenerCount(eventType?: EventName): number {
    if (eventType) {
      return (this.listeners.get(eventType)?.length || 0) +
        (this.listeners.get("*")?.length || 0);
    }
    // Total listeners across all types
    let count = 0;
    for (const listeners of this.listeners.values()) {
      count += listeners.length;
    }
    return count;
  }

  /**
   * Remove all listeners (optionally for a specific event type)
   */
  removeAllListeners(eventType?: EventName): void {
    if (eventType) {
      this.listeners.delete(eventType);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get all registered event types
   */
  eventTypes(): (EventName | "*")[] {
    return Array.from(this.listeners.keys());
  }

  private addListener(
    eventType: EventName | "*",
    listener: EventListener,
    once: boolean
  ): () => void {
    const listeners = this.listeners.get(eventType) || [];
    listeners.push({ listener, once });
    this.listeners.set(eventType, listeners);

    // Return unsubscribe function
    return () => this.removeListener(eventType, listener);
  }

  private removeListener(
    eventType: EventName | "*",
    listener: EventListener
  ): void {
    const listeners = this.listeners.get(eventType);
    if (!listeners) return;

    const index = listeners.findIndex((e) => e.listener === listener);
    if (index !== -1) {
      listeners.splice(index, 1);
    }

    if (listeners.length === 0) {
      this.listeners.delete(eventType);
    }
  }
}

/**
 * Global singleton emitter instance
 *
 * Use this for application-wide event pub/sub.
 * Import individual instances for testing or isolated components.
 */
let globalEmitter: AgentGateEmitter | null = null;

export function getGlobalEmitter(): AgentGateEmitter {
  if (!globalEmitter) {
    globalEmitter = new AgentGateEmitter();
  }
  return globalEmitter;
}

/**
 * Reset the global emitter (for testing)
 */
export function resetGlobalEmitter(): void {
  globalEmitter = null;
}

/**
 * Create a new isolated emitter instance
 */
export function createEmitter(): AgentGateEmitter {
  return new AgentGateEmitter();
}
