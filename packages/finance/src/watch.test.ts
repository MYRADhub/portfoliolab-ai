import { describe, expect, it } from "vitest";
import { watchAlerts, watchSignals } from "./index";

const close = (a: number, b: number, tol = 1e-12) => expect(Math.abs(a - b)).toBeLessThan(tol);

/** 300 closes with small deterministic wiggle around a flat level. */
const quiet = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i) * 0.5);

describe("watchSignals", () => {
  it("computes returns over 1, 5 and 21 days from the latest close", () => {
    const c = Array.from({ length: 30 }, (_, i) => 100 + i);
    const s = watchSignals(c);
    close(s.last, 129);
    close(s.d1!, 129 / 128 - 1);
    close(s.d5!, 129 / 124 - 1);
    close(s.d21!, 129 / 108 - 1);
  });

  it("returns null for a horizon longer than the history", () => {
    const s = watchSignals([100, 101, 102]);
    expect(s.d1).not.toBeNull();
    expect(s.d5).toBeNull();
    expect(s.d21).toBeNull();
    expect(s.z1).toBeNull();
  });

  it("measures the 52-week range over the last 252 closes only", () => {
    const c = [500, ...Array.from({ length: 260 }, () => 100), 120, 110];
    const s = watchSignals(c);
    expect(s.high52).toBe(120); // the 500 is older than a year
    expect(s.low52).toBe(100);
    close(s.fromHigh, 110 / 120 - 1);
    close(s.fromLow, 0.1);
  });

  it("scales the latest move by the stock's own earlier noise", () => {
    const calm = [...quiet, quiet.at(-1)! * 1.05];
    const s = watchSignals(calm);
    expect(s.z1!).toBeGreaterThan(10); // a 5% jump from a stock that wiggles 0.5%
    const normal = watchSignals([...quiet, quiet.at(-1)! + Math.sin(300) * 0.5]);
    expect(Math.abs(normal.z1!)).toBeLessThan(2);
  });

  it("rejects bad input", () => {
    expect(() => watchSignals([100])).toThrow("2 closes");
    expect(() => watchSignals([100, 0])).toThrow("positive");
  });
});

describe("watchAlerts", () => {
  it("flags a big move with the figure that triggered it", () => {
    const a = watchAlerts(watchSignals([...quiet, quiet.at(-1)! * 0.9]));
    const move = a.find((x) => x.kind === "big_move")!;
    expect(move.severity).toBe(2);
    expect(move.text).toContain("-10.0%");
    expect(move.text).toContain("times its normal daily swing");
  });

  it("flags a 21-day fall, and proximity to the 52-week low", () => {
    const c = [
      ...Array.from({ length: 250 }, () => 100),
      ...Array.from({ length: 21 }, (_, i) => 100 - i * 0.7),
    ];
    const kinds = watchAlerts(watchSignals(c)).map((x) => x.kind);
    expect(kinds).toContain("falling");
    expect(kinds).toContain("near_low");
    expect(kinds).not.toContain("near_high");
  });

  it("flags proximity to the 52-week high and lists urgent alerts first", () => {
    const rising = Array.from({ length: 300 }, (_, i) => 100 + i * 0.05 + Math.sin(i * 1.7) * 0.4);
    rising[299] = Math.max(...rising.slice(48)) - 0.1; // just under its high, on an ordinary day
    const a = watchAlerts(watchSignals(rising));
    expect(a.map((x) => x.kind)).toEqual(["near_high"]);
    const mixed = watchAlerts(watchSignals([...rising, rising.at(-1)! * 1.2]));
    expect(mixed[0]!.severity).toBe(2);
  });

  it("says nothing about an unremarkable stock in the middle of its range", () => {
    const c = Array.from(
      { length: 300 },
      (_, i) => 100 + Math.sin(i * 0.3) * 5 + Math.sin(i * 1.9) * 0.3,
    );
    c[299] = 100;
    c[298] = 100.2;
    c[278] = 100.5;
    expect(watchAlerts(watchSignals(c))).toEqual([]);
  });
});
