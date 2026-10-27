import { describe, expect, it } from "vitest";
import { isReliable, RELIABLE_T } from "./force-reliability";

describe("isReliable", () => {
  it("accepts t-statistics at or beyond the bar in either direction", () => {
    expect(isReliable(RELIABLE_T)).toBe(true);
    expect(isReliable(-2.4)).toBe(true);
  });

  it("rejects noise-level, missing and non-finite t-statistics", () => {
    expect(isReliable(1.92)).toBe(false);
    expect(isReliable(-0.38)).toBe(false);
    expect(isReliable(0)).toBe(false);
    expect(isReliable(null)).toBe(false);
    expect(isReliable(Number.NaN)).toBe(false);
  });
});
