import { describe, expect, it } from "vitest";
import { fanBands, quantile, shareBelow, simulateGrowth } from "./index";

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe("simulateGrowth", () => {
  it("grows constant returns deterministically on every path", () => {
    const r = simulateGrowth(Array(50).fill(0.001), { horizonDays: 100, paths: 5 });
    r.terminal.forEach((t) => close(t, 1.001 ** 100, 1e-9));
    r.maxDrawdowns.forEach((d) => expect(d).toBe(0));
    expect(r.checkpoints[0]).toBe(0);
    expect(r.checkpoints.at(-1)).toBe(100);
    r.values.forEach((row) => expect(row).toHaveLength(r.checkpoints.length));
  });

  it("is repeatable for a seed and differs across seeds", () => {
    const returns = Array.from({ length: 200 }, (_, i) => Math.sin(i) * 0.01);
    const a = simulateGrowth(returns, { horizonDays: 60, paths: 20, seed: 4 });
    expect(simulateGrowth(returns, { horizonDays: 60, paths: 20, seed: 4 })).toEqual(a);
    expect(simulateGrowth(returns, { horizonDays: 60, paths: 20, seed: 5 }).terminal).not.toEqual(
      a.terminal,
    );
  });

  it("keeps the average log growth near the history's and records checkpoints at the right days", () => {
    const returns = Array.from({ length: 500 }, (_, i) => 0.0005 + Math.sin(i * 1.3) * 0.01);
    const mu = returns.reduce((a, r) => a + Math.log(1 + r), 0) / returns.length;
    const r = simulateGrowth(returns, {
      horizonDays: 252,
      paths: 600,
      seed: 2,
      checkpointEvery: 63,
    });
    expect(r.checkpoints).toEqual([0, 63, 126, 189, 252]);
    const meanLog = r.terminal.reduce((a, t) => a + Math.log(t), 0) / r.terminal.length;
    expect(Math.abs(meanLog - 252 * mu)).toBeLessThan(0.05);
    expect(Math.min(...r.maxDrawdowns)).toBeLessThanOrEqual(0);
  });

  it("copies whole blocks, wrapping around the end of the history", () => {
    // history 1,2,3 (as returns 0.01, 0.02, 0.03); blockSize equal to the history length reproduces a rotation of it
    const returns = [0.01, 0.02, 0.03];
    const r = simulateGrowth(returns, { horizonDays: 3, paths: 30, blockSize: 3, seed: 9 });
    const product = 1.01 * 1.02 * 1.03;
    r.terminal.forEach((t) => close(t, product, 1e-12)); // any rotation of the same three returns multiplies to the same value
  });

  it("re-centers on a chosen annual return while keeping the history's spread", () => {
    // constant history of +0.2% a day: re-centered on 5.04% a year (0.0002 a day) every path grows at exactly that
    const flat = simulateGrowth(Array(50).fill(0.002), {
      horizonDays: 100,
      paths: 3,
      annualDrift: 0.0504,
    });
    flat.terminal.forEach((t) => close(t, 1.0002 ** 100, 1e-9));

    // for a noisy history the re-centered mean daily return equals the target, and the volatility is unchanged
    const returns = Array.from({ length: 400 }, (_, i) => 0.003 + Math.sin(i * 2.1) * 0.01);
    const target = 0.07 / 252;
    const sim = simulateGrowth(returns, {
      horizonDays: 252,
      paths: 400,
      seed: 6,
      annualDrift: 0.07,
    });
    const hist = simulateGrowth(returns, { horizonDays: 252, paths: 400, seed: 6 });
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    // historical drift is far above the target, so the re-centered paths end much lower
    expect(median(sim.terminal)).toBeLessThan(median(hist.terminal));
    expect(Math.abs(Math.log(median(sim.terminal)) - 252 * target)).toBeLessThan(0.05);
    // same seed and block draws: differences between paths come only from the same shape, so spread of log growth matches
    const sd = (xs: number[]) => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
    };
    expect(Math.abs(sd(sim.terminal.map(Math.log)) - sd(hist.terminal.map(Math.log)))).toBeLessThan(
      0.01,
    );
  });

  it("rejects bad inputs", () => {
    expect(() => simulateGrowth([0.01], { horizonDays: 10, paths: 1 })).toThrow();
    expect(() => simulateGrowth([0.01, 0.02], { horizonDays: 0, paths: 1 })).toThrow();
  });
});

describe("quantile, fanBands, shareBelow", () => {
  it("interpolates quantiles", () => {
    close(quantile([1, 2, 3, 4], 0.5), 2.5);
    close(quantile([10, 0, 5], 0), 0);
    close(quantile([10, 0, 5], 1), 10);
    close(quantile([0, 10], 0.25), 2.5);
    expect(() => quantile([], 0.5)).toThrow();
  });

  it("orders the bands and starts every band at 1", () => {
    const returns = Array.from({ length: 300 }, (_, i) => Math.cos(i) * 0.012);
    const sim = simulateGrowth(returns, { horizonDays: 126, paths: 300, seed: 3 });
    const bands = fanBands(sim, [0.05, 0.5, 0.95]);
    bands[0]!.forEach((v) => close(v, 1));
    for (const b of bands) {
      expect(b[0]!).toBeLessThanOrEqual(b[1]!);
      expect(b[1]!).toBeLessThanOrEqual(b[2]!);
    }
  });

  it("counts the share strictly below a threshold", () => {
    close(shareBelow([0.5, 1, 1.5, 2], 1), 0.25);
    close(shareBelow([0.5, 1, 1.5, 2], 5), 1);
    expect(() => shareBelow([], 1)).toThrow();
  });
});
