import { describe, expect, it } from "vitest";
import {
  annualizedReturn,
  annualizedVolatility,
  commonDates,
  concentration,
  cumulativeGrowth,
  dailyReturns,
  drawdownSeries,
  maxDrawdown,
  normalizeWeights,
  portfolioReturns,
  sectorAllocation,
  sharpeRatio,
  stdev,
  totalReturn,
  validateWeights,
} from "./index";

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe("series", () => {
  const a = [
    { date: "2024-01-02", adjClose: 100 },
    { date: "2024-01-03", adjClose: 110 },
    { date: "2024-01-04", adjClose: 99 },
  ];
  const b = [
    { date: "2024-01-03", adjClose: 50 },
    { date: "2024-01-04", adjClose: 55 },
    { date: "2024-01-05", adjClose: 60 },
  ];

  it("finds the common date window", () => {
    expect(commonDates([a, b])).toEqual(["2024-01-03", "2024-01-04"]);
    expect(commonDates([])).toEqual([]);
  });

  it("computes simple returns", () => {
    const r = dailyReturns(a, ["2024-01-02", "2024-01-03", "2024-01-04"]);
    close(r[0]!, 0.1);
    close(r[1]!, -0.1);
  });

  it("throws on a missing price", () => {
    expect(() => dailyReturns(a, ["2024-01-02", "2024-01-09"])).toThrow(/missing/);
  });

  it("combines constant-weight returns", () => {
    const r = portfolioReturns(
      [0.6, 0.4],
      [
        [0.1, -0.1],
        [0.0, 0.1],
      ],
    );
    close(r[0]!, 0.06);
    close(r[1]!, -0.02);
    expect(() => portfolioReturns([1], [[0.1], [0.2]])).toThrow();
  });
});

describe("metrics", () => {
  it("computes sample standard deviation", () => {
    close(stdev([1, 2, 3, 4]), Math.sqrt(5 / 3));
    expect(() => stdev([1])).toThrow();
  });

  it("annualizes volatility with 252 days", () => {
    close(
      annualizedVolatility([0.01, -0.01, 0.01, -0.01]),
      stdev([0.01, -0.01, 0.01, -0.01]) * Math.sqrt(252),
    );
  });

  it("compounds returns", () => {
    expect(cumulativeGrowth([0.1, -0.1])).toEqual([1, 1.1, 1.1 * 0.9]);
    close(totalReturn([0.1, -0.1]), -0.01);
  });

  it("annualizes a 252-day return to itself", () => {
    const r = Array.from({ length: 252 }, () => 0.001);
    close(annualizedReturn(r), totalReturn(r), 1e-9);
  });

  it("finds max drawdown", () => {
    // 1 -> 1.2 -> 0.9 -> 1.8 : peak 1.2, trough 0.9
    close(maxDrawdown([0.2, -0.25, 1.0]), 0.9 / 1.2 - 1);
    expect(maxDrawdown([0.1, 0.1])).toBe(0);
  });

  it("builds a drawdown series", () => {
    const d = drawdownSeries([0.2, -0.25]);
    expect(d[0]).toBe(0);
    expect(d[1]).toBe(0);
    close(d[2]!, -0.25);
  });

  it("computes Sharpe and handles zero volatility", () => {
    const r = [0.01, -0.005, 0.02, 0.0];
    const expected = (r.reduce((a, b) => a + b, 0) / 4) * 252;
    close(sharpeRatio(r), expected / annualizedVolatility(r));
    close(sharpeRatio(r, 0.02), (expected - 0.02) / annualizedVolatility(r));
    expect(() => sharpeRatio([0.01, 0.01, 0.01])).toThrow(/zero volatility/);
  });
});

describe("weights", () => {
  it("accepts weights that sum to 1", () => {
    expect(
      validateWeights([
        { ticker: "A", weight: 0.4 },
        { ticker: "B", weight: 0.6 },
      ]),
    ).toEqual([]);
  });

  it("reports empty, duplicates, non-positive and bad sum", () => {
    expect(validateWeights([])).toEqual([{ kind: "empty" }]);
    const issues = validateWeights([
      { ticker: "A", weight: 0.5 },
      { ticker: "A", weight: -0.1 },
    ]);
    expect(issues).toEqual(
      expect.arrayContaining([
        { kind: "duplicate", ticker: "A" },
        { kind: "non_positive", ticker: "A" },
        expect.objectContaining({ kind: "sum" }),
      ]),
    );
  });

  it("normalizes", () => {
    const n = normalizeWeights([
      { ticker: "A", weight: 25 },
      { ticker: "B", weight: 75 },
    ]);
    expect(n.map((x) => x.weight)).toEqual([0.25, 0.75]);
    expect(() => normalizeWeights([{ weight: 0 }])).toThrow();
  });

  it("computes concentration for the example portfolio", () => {
    const { hhi, effectiveN } = concentration([0.25, 0.2, 0.2, 0.15, 0.2]);
    close(hhi, 0.0625 + 0.04 * 3 + 0.0225);
    close(effectiveN, 1 / hhi);
    expect(concentration([1]).effectiveN).toBe(1);
  });

  it("aggregates sectors and labels unknowns", () => {
    const s = sectorAllocation([
      { sector: "Tech", weight: 0.3 },
      { sector: "Tech", weight: 0.3 },
      { sector: null, weight: 0.4 },
    ]);
    expect(s[0]).toMatchObject({ sector: "Tech" });
    close(s[0]!.weight, 0.6);
    expect(s[1]).toEqual({ sector: "Unclassified", weight: 0.4 });
  });
});
