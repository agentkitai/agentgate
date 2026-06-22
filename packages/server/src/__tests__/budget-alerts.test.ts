/**
 * Per-agent budget threshold alerts (#13 near-limit hook) —
 * maybeAlertBudgetThreshold dedup + band selection.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventNames } from "@agentgate/core";
import type { BudgetVerdict } from "../lib/agent-budget.js";
import { maybeAlertBudgetThreshold, resetBudgetAlerts } from "../lib/budget-alerts.js";
import { getGlobalDispatcher } from "../lib/notification/index.js";

const verdict = (spentUsd: number, limitUsd: number | null): BudgetVerdict => ({
  allowed: limitUsd === null || spentUsd < limitUsd,
  limitUsd,
  spentUsd,
});

let dispatch: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetBudgetAlerts();
  // dispatchSync is fire-and-forget — stub it so no real channels are touched.
  dispatch = vi.spyOn(getGlobalDispatcher(), "dispatchSync").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** The single event the most recent dispatch call carried. */
function lastEvent() {
  return dispatch.mock.calls.at(-1)?.[0] as { type: string; payload: { threshold: number } };
}

describe("maybeAlertBudgetThreshold", () => {
  it("no-ops for an agent with no budget", () => {
    maybeAlertBudgetThreshold("agt_a", verdict(999, null), "default");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("no-ops below the lowest threshold", () => {
    maybeAlertBudgetThreshold("agt_a", verdict(70, 100), "default"); // 70%
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("fires a budget.threshold event at 80%", () => {
    maybeAlertBudgetThreshold("agt_a", verdict(85, 100), "default");
    expect(dispatch).toHaveBeenCalledTimes(1);
    const ev = lastEvent();
    expect(ev.type).toBe(EventNames.BUDGET_THRESHOLD);
    expect(ev.payload).toMatchObject({ agentId: "agt_a", threshold: 0.8, spentUsd: 85, limitUsd: 100 });
  });

  it("dedups: the same band does not re-fire within a month", () => {
    maybeAlertBudgetThreshold("agt_a", verdict(85, 100), "default");
    maybeAlertBudgetThreshold("agt_a", verdict(90, 100), "default");
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("escalates to the 100% band once even after the 80% alert", () => {
    maybeAlertBudgetThreshold("agt_a", verdict(85, 100), "default"); // 0.8
    maybeAlertBudgetThreshold("agt_a", verdict(120, 100), "default"); // 1.0
    maybeAlertBudgetThreshold("agt_a", verdict(130, 100), "default"); // dedup
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(lastEvent().payload.threshold).toBe(1.0);
  });

  it("reports only the highest crossed band on a single jump", () => {
    maybeAlertBudgetThreshold("agt_a", verdict(150, 100), "default"); // straight to 150%
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(lastEvent().payload.threshold).toBe(1.0);
  });

  it("tracks agents independently", () => {
    maybeAlertBudgetThreshold("agt_a", verdict(85, 100), "default");
    maybeAlertBudgetThreshold("agt_b", verdict(85, 100), "default");
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("tracks the same agent independently across tenants", () => {
    // Same agent id, two tenants with independent spend — both must alert.
    maybeAlertBudgetThreshold("agt_a", verdict(85, 100), "tenant-1");
    maybeAlertBudgetThreshold("agt_a", verdict(85, 100), "tenant-2");
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("fires at exactly the threshold boundary (>=)", () => {
    maybeAlertBudgetThreshold("agt_a", verdict(80, 100), "default"); // exactly 80%
    maybeAlertBudgetThreshold("agt_b", verdict(100, 100), "default"); // exactly 100%
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ payload: { threshold: 0.8 } });
    expect(dispatch.mock.calls[1]?.[0]).toMatchObject({ payload: { threshold: 1.0 } });
  });

  it("does not fire on a brand-new agent with zero spend", () => {
    maybeAlertBudgetThreshold("agt_a", verdict(0, 100), "default");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("re-arms when the calendar month rolls over", () => {
    const jan = new Date(Date.UTC(2026, 0, 15));
    const feb = new Date(Date.UTC(2026, 1, 15));
    maybeAlertBudgetThreshold("agt_a", verdict(85, 100), "default", jan);
    maybeAlertBudgetThreshold("agt_a", verdict(85, 100), "default", jan); // dedup
    maybeAlertBudgetThreshold("agt_a", verdict(85, 100), "default", feb); // new month → fires
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("ignores a non-positive cap without dividing by zero", () => {
    maybeAlertBudgetThreshold("agt_a", verdict(10, 0), "default"); // zero cap
    maybeAlertBudgetThreshold("agt_b", verdict(10, -5), "default"); // negative cap
    expect(dispatch).not.toHaveBeenCalled();
  });
});
