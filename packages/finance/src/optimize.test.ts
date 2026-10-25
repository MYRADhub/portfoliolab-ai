import { describe, expect, it } from "vitest";
import {
  equalWeights,
  exposureEnergy,
  exposureGram,
  minVarianceWeights,
  portfolioVariance,
  projectCappedSimplex,
  riskParityWeights,
  riskShares,
} from "./index";

const close = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);
const diag = (...v: number[]) => v.map((x, i) => v.map((_, j) => (i === j ? x : 0)));

describe("projectCappedSimplex", () => {
  it("leaves a feasible point alone and normalizes a shifted one", () => {
    const p = projectCappedSimplex([0.2, 0.3, 0.5]);
    [0.2, 0.3, 0.5].forEach((x, i) => close(p[i]!, x, 1e-9));
    const q = projectCappedSimplex([0.9, 0.9, 0.9], 0.5);
    q.forEach((x) => close(x, 1 / 3, 1e-9));
  });

  it("respects the cap and the sum, and clips negatives", () => {
    const p = projectCappedSimplex([5, 0, 0], 0.6);
    [0.6, 0.2, 0.2].forEach((x, i) => close(p[i]!, x, 1e-9));
    const r = projectCappedSimplex([-3, 0.5, 2.5], 1);
    close(
      r.reduce((a, b) => a + b, 0),
      1,
      1e-9,
    );
    expect(Math.min(...r)).toBeGreaterThanOrEqual(0);
  });

  it("rejects impossible caps and empty input", () => {
    expect(() => projectCappedSimplex([1, 2, 3], 0.3)).toThrow(/cap too small/);
    expect(() => projectCappedSimplex([])).toThrow();
  });
});

describe("minVarianceWeights", () => {
  it("matches the closed form for two assets", () => {
    // sigma1 0.2, sigma2 0.1, rho 0.3: w1 = (s2^2 - rho s1 s2) / (s1^2 + s2^2 - 2 rho s1 s2) = 0.004 / 0.038
    const cov = [
      [0.04, 0.006],
      [0.006, 0.01],
    ];
    const w = minVarianceWeights(cov);
    close(w[0]!, 0.004 / 0.038, 1e-6);
    close(w[1]!, 1 - 0.004 / 0.038, 1e-6);
  });

  it("is proportional to inverse variance for uncorrelated assets", () => {
    const w = minVarianceWeights(diag(0.04, 0.01, 0.0025));
    [25 / 525, 100 / 525, 400 / 525].forEach((x, i) => close(w[i]!, x, 1e-6));
  });

  it("redistributes the excess when a cap binds", () => {
    // uncapped: 0.048, 0.19, 0.76. Capped at 0.5 the rest is shared in proportion 25:100 of the remaining 0.5.
    const w = minVarianceWeights(diag(0.04, 0.01, 0.0025), { maxWeight: 0.5 });
    [0.1, 0.4, 0.5].forEach((x, i) => close(w[i]!, x, 1e-6));
  });

  it("never gives a negative weight and never has more variance than equal weights", () => {
    const cov = [
      [0.04, 0.03, 0.01],
      [0.03, 0.05, 0.0],
      [0.01, 0.0, 0.02],
    ];
    const w = minVarianceWeights(cov);
    expect(Math.min(...w)).toBeGreaterThanOrEqual(-1e-12);
    close(
      w.reduce((a, b) => a + b, 0),
      1,
      1e-9,
    );
    expect(portfolioVariance(w, cov)).toBeLessThanOrEqual(
      portfolioVariance(equalWeights(3), cov) + 1e-12,
    );
  });

  it("rejects a matrix with no variance", () => {
    expect(() => minVarianceWeights(diag(0, 0))).toThrow();
  });
});

describe("riskParityWeights and riskShares", () => {
  it("is proportional to inverse volatility for uncorrelated assets", () => {
    const w = riskParityWeights(diag(0.04, 0.01, 0.0025)); // sigma 0.2, 0.1, 0.05
    [5 / 35, 10 / 35, 20 / 35].forEach((x, i) => close(w[i]!, x, 1e-6));
  });

  it("equalizes every asset's share of variance for a correlated matrix", () => {
    const cov = [
      [0.04, 0.012, 0.004],
      [0.012, 0.0225, 0.003],
      [0.004, 0.003, 0.01],
    ];
    const w = riskParityWeights(cov);
    riskShares(w, cov).forEach((s) => close(s, 1 / 3, 1e-6));
  });

  it("gives shares that sum to one and match a hand calculation", () => {
    // w = (0.5, 0.5), cov [[0.04, 0],[0, 0.01]]: variance 0.0125; shares 0.01/0.0125 = 0.8 and 0.2
    const s = riskShares([0.5, 0.5], diag(0.04, 0.01));
    close(s[0]!, 0.8, 1e-12);
    close(s[1]!, 0.2, 1e-12);
    expect(() => riskShares([0, 0], diag(0.04, 0.01))).toThrow();
  });
});

describe("exposureGram and exposureEnergy", () => {
  it("builds the inner products of the holdings' exposure vectors", () => {
    // holding A: (2, 0), B: (-2, 1), C: (0, 3)
    const q = exposureGram([
      [2, 0],
      [-2, 1],
      [0, 3],
    ]);
    expect(q).toEqual([
      [4, -4, 0],
      [-4, 5, 3],
      [0, 3, 9],
    ]);
  });

  it("makes w'Qw equal the sum of squared net loadings", () => {
    const e = [
      [2, 0],
      [-2, 1],
      [0, 3],
    ];
    const w = [0.5, 0.3, 0.2];
    const q = exposureGram(e);
    // net loadings: 0.5*2 + 0.3*-2 = 0.4 and 0.3*1 + 0.2*3 = 0.9 -> 0.16 + 0.81
    close(exposureEnergy(w, e), 0.97, 1e-12);
    close(portfolioVariance(w, q), 0.97, 1e-12);
  });

  it("finds an exact hedge: opposite exposures cancel at equal weights", () => {
    const e = [[2], [-2]];
    const w = minVarianceWeights(exposureGram(e));
    close(w[0]!, 0.5, 1e-6);
    close(exposureEnergy(w, e), 0, 1e-9);
  });

  it("leans toward the holding with the smallest dependence, and respects a cap", () => {
    // one force; loadings 3, 1, 2 -> energy (3a + b + 2c)^2 is minimized by putting everything in b
    const e = [[3], [1], [2]];
    const w = minVarianceWeights(exposureGram(e));
    close(w[1]!, 1, 1e-6);
    const capped = minVarianceWeights(exposureGram(e), { maxWeight: 0.5 });
    close(capped[1]!, 0.5, 1e-6);
    expect(exposureEnergy(capped, e)).toBeGreaterThan(exposureEnergy(w, e));
    expect(exposureEnergy(w, e)).toBeLessThanOrEqual(exposureEnergy([1 / 3, 1 / 3, 1 / 3], e));
  });
});
