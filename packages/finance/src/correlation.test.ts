import { describe, expect, it } from "vitest";
import {
  averagePairwise,
  clusterOrder,
  correlationMatrix,
  correlationWith,
  covarianceMatrix,
  diversificationRatio,
  pearson,
  rollingCorrelation,
  worstDaysIndices,
} from "./index";

const close = (a: number, b: number, tol = 1e-12) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe("pearson", () => {
  it("returns 1, -1 and 0 for the textbook cases", () => {
    close(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1);
    close(pearson([1, 2, 3, 4], [8, 6, 4, 2]), -1);
    close(pearson([1, -1, 1, -1], [1, 1, -1, -1]), 0);
  });

  it("matches a hand-computed value", () => {
    // x = [1,2,3,4,5], y = [2,1,4,3,5]: sxy = 8, sxx = syy = 10 -> 0.8
    close(pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]), 0.8);
  });

  it("rejects mismatched, short, and constant series", () => {
    expect(() => pearson([1, 2, 3], [1, 2])).toThrow(/mismatch/);
    expect(() => pearson([1, 2], [1, 2])).toThrow(/at least 3/);
    expect(() => pearson([1, 1, 1], [1, 2, 3])).toThrow(/zero variance/);
  });
});

describe("correlationMatrix", () => {
  const r = [
    [1, 2, 3, 4, 5],
    [2, 1, 4, 3, 5],
    [5, 4, 3, 2, 1],
  ];
  const m = correlationMatrix(r);

  it("is symmetric with a unit diagonal", () => {
    for (let i = 0; i < 3; i++) {
      expect(m[i]![i]).toBe(1);
      for (let j = 0; j < 3; j++) close(m[i]![j]!, m[j]![i]!);
    }
    close(m[0]![1]!, 0.8);
    close(m[0]![2]!, -1);
  });

  it("averages off-diagonals and handles a single asset", () => {
    close(averagePairwise(m)!, (0.8 - 1 + pearson(r[1]!, r[2]!)) / 3);
    expect(averagePairwise([[1]])).toBeNull();
  });
});

describe("covariance and diversification", () => {
  const x = [1, -1, 1, -1];
  const y = [1, 1, -1, -1];

  it("computes sample covariance", () => {
    const c = covarianceMatrix([x, y]);
    close(c[0]![0]!, 4 / 3);
    close(c[0]![1]!, 0);
  });

  it("is 1 for perfectly correlated assets and sqrt(2) for two uncorrelated equal-vol assets", () => {
    close(diversificationRatio([0.5, 0.5], [x, x]), 1);
    close(diversificationRatio([0.5, 0.5], [x, y]), Math.SQRT2);
  });

  it("rejects a zero-variance portfolio", () => {
    expect(() => diversificationRatio([0.5, 0.5], [x, x.map((v) => -v)])).toThrow(
      /zero portfolio variance/,
    );
  });

  it("correlates each asset with a reference", () => {
    const [a, b] = correlationWith(x, [x, y]);
    close(a!, 1);
    close(b!, 0);
  });
});

describe("rollingCorrelation", () => {
  it("equals pearson when the window spans the series and slides otherwise", () => {
    const x = [1, 2, 3, 4, 5, 6];
    const y = [2, 1, 4, 3, 6, 5];
    expect(rollingCorrelation(x, y, 6)).toEqual([pearson(x, y)]);
    expect(rollingCorrelation(x, y, 4)).toHaveLength(3);
    close(rollingCorrelation(x, y, 4)[1]!, pearson(x.slice(1, 5), y.slice(1, 5)));
  });

  it("validates the window", () => {
    expect(() => rollingCorrelation([1, 2, 3], [1, 2, 3], 2)).toThrow();
    expect(() => rollingCorrelation([1, 2, 3], [1, 2, 3], 4)).toThrow();
  });
});

describe("worstDaysIndices", () => {
  it("selects the worst fraction in index order, at least one", () => {
    expect(
      worstDaysIndices([0.01, -0.05, 0.02, -0.03, 0.0, 0.01, -0.01, 0.03, 0.02, 0.0], 0.2),
    ).toEqual([1, 3]);
    expect(worstDaysIndices([0.1, -0.1, 0.2], 0.01)).toEqual([1]);
  });
});

describe("clusterOrder", () => {
  it("keeps highly correlated assets adjacent and is a permutation", () => {
    const m = [
      [1, 0.1, 0.9, 0.0],
      [0.1, 1, 0.1, 0.8],
      [0.9, 0.1, 1, 0.1],
      [0.0, 0.8, 0.1, 1],
    ];
    const order = clusterOrder(m);
    expect([...order].sort()).toEqual([0, 1, 2, 3]);
    expect(Math.abs(order.indexOf(0) - order.indexOf(2))).toBe(1);
    expect(Math.abs(order.indexOf(1) - order.indexOf(3))).toBe(1);
  });

  it("handles one and zero assets", () => {
    expect(clusterOrder([[1]])).toEqual([0]);
    expect(clusterOrder([])).toEqual([]);
  });
});
