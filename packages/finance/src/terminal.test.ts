import { describe, expect, it } from "vitest";
import {
  bestWorstDays,
  drawdownEpisodes,
  expectedShortfall,
  histogram,
  historicalVar,
  monthlyReturns,
  periodReturn,
  riskContributions,
  rollingVolatility,
  stdev,
  topDays,
  upDayShare,
} from "./index";

const close = (a: number, b: number, tol = 1e-12) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe("periodReturn and day statistics", () => {
  it("compounds the last n returns and refuses without enough history", () => {
    close(periodReturn([0.1, -0.1, 0.2], 2)!, 0.9 * 1.2 - 1);
    close(periodReturn([0.1, -0.1, 0.2], 3)!, 1.1 * 0.9 * 1.2 - 1);
    expect(periodReturn([0.1], 2)).toBeNull();
    expect(periodReturn([0.1], 0)).toBeNull();
  });

  it("finds the best and worst days and the share of up days", () => {
    const r = bestWorstDays(["a", "b", "c", "d"], [0.01, -0.03, 0.04, 0]);
    expect(r).toEqual({ best: { date: "c", value: 0.04 }, worst: { date: "b", value: -0.03 } });
    close(upDayShare([0.01, -0.03, 0.04, 0]), 0.5);
    expect(() => bestWorstDays(["a"], [])).toThrow();
    expect(() => upDayShare([])).toThrow();
  });
});

describe("value at risk", () => {
  const r = Array.from({ length: 100 }, (_, i) => (i - 50) / 1000); // -0.050 ... +0.049
  it("is the return beaten only on the worst share of days", () => {
    close(historicalVar(r, 0.95), -0.046); // 5th worst of 100
    close(historicalVar(r, 0.99), -0.05); // worst of 100
  });

  it("expected shortfall averages the tail and is at least as bad as VaR", () => {
    close(expectedShortfall(r, 0.95), (-0.05 - 0.049 - 0.048 - 0.047 - 0.046) / 5);
    expect(expectedShortfall(r, 0.95)).toBeLessThanOrEqual(historicalVar(r, 0.95));
  });

  it("validates input", () => {
    expect(() => historicalVar([], 0.95)).toThrow();
    expect(() => historicalVar([0.1], 1)).toThrow();
    close(historicalVar([0.01, -0.02], 0.95), -0.02); // tiny sample falls back to the worst day
  });
});

describe("rolling volatility", () => {
  it("annualizes each window's sample deviation", () => {
    const r = [0.01, -0.01, 0.02, -0.02, 0.0];
    const v = rollingVolatility(r, 3);
    expect(v).toHaveLength(3);
    close(v[0]!, stdev([0.01, -0.01, 0.02]) * Math.sqrt(252));
    close(v[2]!, stdev([0.02, -0.02, 0.0]) * Math.sqrt(252));
    expect(() => rollingVolatility(r, 1)).toThrow();
    expect(() => rollingVolatility(r, 9)).toThrow();
  });
});

describe("histogram", () => {
  it("counts every value exactly once, with the maximum in the last bin", () => {
    const h = histogram([0, 1, 2, 3, 4], 2);
    expect(h.map((b) => b.count)).toEqual([2, 3]);
    expect(h.reduce((a, b) => a + b.count, 0)).toBe(5);
    close(h[0]!.from, 0);
    close(h[1]!.to, 4);
  });

  it("handles identical values and validates input", () => {
    expect(histogram([2, 2, 2], 3).reduce((a, b) => a + b.count, 0)).toBe(3);
    expect(() => histogram([], 3)).toThrow();
  });
});

describe("monthlyReturns", () => {
  it("compounds within each calendar month in order", () => {
    const m = monthlyReturns(["2026-01-30", "2026-01-31", "2026-02-02"], [0.1, 0.1, -0.5]);
    expect(m.map((x) => x.month)).toEqual(["2026-01", "2026-02"]);
    close(m[0]!.return, 1.1 * 1.1 - 1);
    close(m[1]!.return, -0.5);
    expect(() => monthlyReturns(["a"], [])).toThrow();
  });
});

describe("drawdownEpisodes", () => {
  // value: 1 -> 1.2 -> 0.9 -> 1.0 -> 1.3 -> 1.04 -> 1.04
  const dates = ["d0", "d1", "d2", "d3", "d4", "d5", "d6"];
  const returns = [0.2, 0.9 / 1.2 - 1, 1.0 / 0.9 - 1, 1.3 - 1, 1.04 / 1.3 - 1, 0];

  it("finds the deepest declines with their peak, trough and recovery", () => {
    const e = drawdownEpisodes(dates, returns, 3);
    expect(e).toHaveLength(2);
    expect(e[0]).toMatchObject({ peak: "d1", trough: "d2", recovery: "d4", daysToTrough: 1 });
    close(e[0]!.depth, 0.9 / 1.2 - 1);
    expect(e[1]).toMatchObject({ peak: "d4", trough: "d5", recovery: null });
    close(e[1]!.depth, 1.04 / 1.3 - 1);
  });

  it("limits to the top n, and returns nothing for a series that only rises", () => {
    expect(drawdownEpisodes(dates, returns, 1)).toHaveLength(1);
    expect(drawdownEpisodes(["a", "b", "c"], [0.1, 0.1])).toEqual([]);
    expect(() => drawdownEpisodes(["a"], [0.1])).toThrow();
  });
});

describe("riskContributions", () => {
  const x = [1, -1, 1, -1];
  const y = [1, 1, -1, -1];

  it("sums to 1 and gives uncorrelated equal-risk assets equal shares", () => {
    const rc = riskContributions([0.5, 0.5], [x, y]);
    close(
      rc.reduce((a, c) => a + c.share, 0),
      1,
    );
    close(rc[0]!.share, 0.5);
    close(rc[1]!.share, 0.5);
  });

  it("gives a riskier asset more than its weight and a hedge a negative share", () => {
    const wild = x.map((v) => v * 3);
    const rc = riskContributions([0.5, 0.5], [wild, y]);
    expect(rc[0]!.share).toBeGreaterThan(0.5);
    expect(rc[0]!.share).toBeCloseTo(0.9, 10); // variance 9 vs 1 at equal weights, uncorrelated
    const hedged = riskContributions([0.8, 0.2], [x, x.map((v) => -v * 0.5)]);
    expect(hedged[1]!.share).toBeLessThan(0);
    close(
      hedged.reduce((a, c) => a + c.share, 0),
      1,
    );
  });

  it("rejects a zero-variance portfolio", () => {
    expect(() => riskContributions([0.5, 0.5], [x, x.map((v) => -v)])).toThrow(
      /zero portfolio variance/,
    );
  });
});

describe("topDays", () => {
  it("lists the most extreme days first on each side and never repeats a day", () => {
    const dates = ["a", "b", "c", "d", "e", "f"];
    const t = topDays(dates, [0.01, -0.03, 0.05, -0.01, 0.02, -0.04], 2);
    expect(t.best.map((d) => d.date)).toEqual(["c", "e"]);
    expect(t.worst.map((d) => d.date)).toEqual(["f", "b"]);
    expect(topDays(dates, [0.01, -0.03, 0.05, -0.01, 0.02, -0.04], 6).best).toHaveLength(6);
  });

  it("handles fewer days than requested, ties, and mismatched input", () => {
    expect(topDays(["a", "b"], [0.01, 0.01], 5).best.map((d) => d.date)).toEqual(["b", "a"]);
    expect(topDays([], [], 3)).toEqual({ best: [], worst: [] });
    expect(() => topDays(["a"], [])).toThrow();
  });
});
