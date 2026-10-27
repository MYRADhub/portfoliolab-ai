import { describe, expect, it } from "vitest";
import { mulberry32, proxySensitivity, ranks, spearman } from "./index";

describe("ranks and spearman", () => {
  it("averages tied ranks", () => {
    expect(ranks([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
  });

  it("is 1 for any increasing relationship, -1 for decreasing, and matches a hand calculation", () => {
    expect(spearman([1, 2, 3, 4], [1, 4, 9, 100])).toBeCloseTo(1, 12);
    expect(spearman([1, 2, 3, 4], [9, 7, 3, -1])).toBeCloseTo(-1, 12);
    // ranks x 1..5, y 2,1,4,3,5: d^2 = 1+1+1+1+0 = 4, rho = 1 - 6*4/(5*24) = 0.8
    expect(spearman([1, 2, 3, 4, 5], [20, 10, 40, 30, 50])).toBeCloseTo(0.8, 12);
  });

  it("is null for too few points or a constant side, and rejects unequal lengths", () => {
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(() => spearman([1, 2, 3], [1, 2])).toThrow();
  });
});

describe("proxySensitivity", () => {
  const rand = mulberry32(7);
  const noise = (sd: number) => (rand() - 0.5) * 2 * sd * Math.sqrt(3);
  const n = 500;
  const market = Array.from({ length: n }, () => noise(0.01));
  // the signal is half market, half its own movement
  const own = Array.from({ length: n }, () => noise(0.01));
  const signal = market.map((m, i) => 0.5 * m + own[i]!);

  it("recovers a stock's loading on the signal's own movement, not on the market part of it", () => {
    const stock = market.map((m, i) => 1.1 * m + 0.8 * own[i]! + noise(0.005));
    const s = proxySensitivity(stock, market, signal)!;
    expect(s.beta).toBeGreaterThan(0.7);
    expect(s.beta).toBeLessThan(0.9);
    expect(s.t).toBeGreaterThan(10);
    expect(s.n).toBe(n);
  });

  it("finds nothing for a stock that only follows the market, and a negative loading for one that moves against", () => {
    const flat = proxySensitivity(
      market.map((m) => 1.2 * m + noise(0.005)),
      market,
      signal,
    )!;
    expect(Math.abs(flat.t)).toBeLessThan(3);
    const against = proxySensitivity(
      market.map((m, i) => m - 0.5 * own[i]! + noise(0.005)),
      market,
      signal,
    )!;
    expect(against.beta).toBeLessThan(-0.4);
  });

  it("is null with too few days or a signal the market fully explains, and rejects unequal lengths", () => {
    expect(
      proxySensitivity(market.slice(0, 20), market.slice(0, 20), signal.slice(0, 20)),
    ).toBeNull();
    expect(
      proxySensitivity(
        market,
        market,
        market.map((m) => 2 * m),
      ),
    ).toBeNull();
    expect(() => proxySensitivity(market, market.slice(1), signal)).toThrow();
  });
});
