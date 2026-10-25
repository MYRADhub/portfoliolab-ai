import { describe, expect, it } from "vitest";
import { TRADING_DAYS, benchmarkRelative, rollingBeta } from "./index";

const close = (a: number | null, b: number, tol = 1e-10) =>
  expect(Math.abs((a as number) - b)).toBeLessThan(tol);
const rb = [0.01, -0.02, 0.03, -0.01, 0.02];

describe("benchmarkRelative", () => {
  it("a portfolio that moves twice as much as the benchmark has beta 2, no alpha and double the captures", () => {
    const s = benchmarkRelative(
      rb.map((x) => 2 * x),
      rb,
    );
    close(s.beta, 2);
    close(s.alpha, 0);
    close(s.correlation, 1);
    close(s.rSquared, 1);
    close(s.upCapture, 2);
    close(s.downCapture, 2);
    // the daily difference is the benchmark itself, so tracking error is its annualized standard deviation
    const m = rb.reduce((a, b) => a + b, 0) / rb.length;
    const sd = Math.sqrt(rb.reduce((a, b) => a + (b - m) ** 2, 0) / (rb.length - 1));
    close(s.trackingError, sd * Math.sqrt(TRADING_DAYS));
    close(s.battingAverage, 0.6); // beats the benchmark on the three up days only
  });

  it("a portfolio that is the benchmark plus a steady daily amount has beta 1 and alpha equal to that amount times 252", () => {
    const s = benchmarkRelative(
      rb.map((x) => x + 0.0004),
      rb,
    );
    close(s.beta, 1);
    close(s.alpha, 0.0004 * TRADING_DAYS);
    close(s.trackingError, 0, 1e-12);
    expect(s.informationRatio).toBeNull(); // the two never differ in how they move
    close(s.battingAverage, 1);
    expect(s.activeReturn).toBeGreaterThan(0);
  });

  it("matches a hand-computed beta and correlation", () => {
    // benchmark 1,2,3 (deviations -1,0,1), portfolio 2,2,5 (deviations -1,-1,2): cov = 3/2... use sums: sbb 2, spb 3, spp 6
    const b = [0.01, 0.02, 0.03];
    const p = [0.02, 0.02, 0.05];
    const s = benchmarkRelative(p, b);
    close(s.beta, 1.5);
    close(s.correlation, 3 / Math.sqrt(2 * 6));
  });

  it("is a half-capture on down days for a portfolio that falls half as much", () => {
    const s = benchmarkRelative(
      rb.map((x) => (x < 0 ? x / 2 : x)),
      rb,
    );
    close(s.upCapture, 1);
    close(s.downCapture, 0.5);
  });

  it("returns nulls when the benchmark never moves or has no up or down days, and rejects bad input", () => {
    const flat = benchmarkRelative([0.01, 0.02, -0.01], [0.001, 0.001, 0.001]);
    expect(flat.beta).toBeNull();
    expect(flat.alpha).toBeNull();
    expect(flat.correlation).toBeNull();
    expect(flat.downCapture).toBeNull(); // no down days
    expect(() => benchmarkRelative([0.01], [0.01])).toThrow();
    expect(() => benchmarkRelative([0.01, 0.02, 0.03], [0.01, 0.02])).toThrow();
  });
});

describe("rollingBeta", () => {
  it("is constant for a constant multiple and starts once a full window exists", () => {
    const b = Array.from({ length: 12 }, (_, i) => Math.sin(i) * 0.01);
    const r = rollingBeta(
      b.map((x) => 1.5 * x),
      b,
      5,
    );
    expect(r).toHaveLength(8);
    expect(r[0]!.index).toBe(4);
    r.forEach((x) => close(x.beta, 1.5));
  });

  it("skips windows where the benchmark is flat and rejects mismatched input", () => {
    const b = [0.01, 0.01, 0.01, 0.01, 0.02, 0.03];
    expect(rollingBeta(b, b, 4).map((x) => x.index)).toEqual([4, 5]);
    expect(() => rollingBeta([1], [1, 2], 2)).toThrow();
  });
});
