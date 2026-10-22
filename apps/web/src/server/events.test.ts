import { describe, expect, it } from "vitest";
import { markEarningsOverlap } from "./events";

const ev = (ticker: string, eventType: string | null, eventDate: string) => ({
  ticker,
  eventType,
  eventDate,
  overlapsEarnings: false,
});

describe("markEarningsOverlap", () => {
  it("flags other news within a week of an earnings or guidance event for the same stock", () => {
    const list = [
      ev("A", "earnings_release", "2026-03-10"),
      ev("A", "leadership_change", "2026-03-12"), // 2 days after
      ev("A", "m_and_a", "2026-03-03"), // exactly 7 days before
      ev("A", "m_and_a", "2026-03-02"), // 8 days before
      ev("A", "other", "2026-03-17"), // exactly 7 days after
      ev("A", "other", "2026-03-18"), // 8 days after
    ];
    markEarningsOverlap(list);
    expect(list.map((e) => e.overlapsEarnings)).toEqual([false, true, true, false, true, false]);
  });

  it("does not flag the earnings events themselves, other stocks, or news with no earnings nearby", () => {
    const list = [
      ev("A", "earnings_release", "2026-03-10"),
      ev("A", "guidance_cut", "2026-03-11"),
      ev("B", "m_and_a", "2026-03-10"),
      ev("C", null, "2026-03-10"),
    ];
    markEarningsOverlap(list);
    expect(list.map((e) => e.overlapsEarnings)).toEqual([false, false, false, false]);
  });

  it("treats unclassified event types as ordinary news", () => {
    const list = [ev("A", "guidance_raise", "2026-03-10"), ev("A", null, "2026-03-10")];
    markEarningsOverlap(list);
    expect(list[1]!.overlapsEarnings).toBe(true);
  });
});
