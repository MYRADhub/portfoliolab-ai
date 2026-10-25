import { describe, expect, it } from "vitest";
import { attributeToFactors, crossSectionFit, solveLinear } from "./index";

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol);

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
}

describe("solveLinear", () => {
  it("solves a known system", () => {
    const x = solveLinear(
      [
        [2, 1],
        [1, 3],
      ],
      [5, 10],
    )!;
    close(x[0]!, 1);
    close(x[1]!, 3);
  });

  it("needs pivoting and still solves", () => {
    const x = solveLinear(
      [
        [0, 1],
        [1, 0],
      ],
      [4, 7],
    )!;
    expect(x).toEqual([7, 4]);
  });

  it("returns null for a singular system", () => {
    expect(
      solveLinear(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toBeNull();
  });
});

describe("crossSectionFit", () => {
  const r = rng(11);
  const loadings = Array.from({ length: 200 }, () => [r() * 6, r() * 6, r() * 6]);

  it("recovers coefficients from noiseless data when the ridge is negligible", () => {
    const y = loadings.map((l) => 0.001 + 0.002 * l[0]! - 0.003 * l[1]! + 0 * l[2]!);
    const f = crossSectionFit(loadings, y, 1e-9)!;
    close(f.intercept, 0.001, 1e-7);
    close(f.coefficients[0]!, 0.002, 1e-7);
    close(f.coefficients[1]!, -0.003, 1e-7);
    close(f.coefficients[2]!, 0, 1e-7);
    expect(f.adjustedR2).toBeGreaterThan(0.999);
    expect(f.n).toBe(200);
  });

  it("explains little when returns are unrelated to the exposures", () => {
    const rr = rng(99);
    const y = loadings.map(() => rr() * 0.02);
    expect(Math.abs(crossSectionFit(loadings, y)!.adjustedR2)).toBeLessThan(0.05);
  });

  it("shrinks coefficients toward zero as the ridge grows", () => {
    const y = loadings.map((l) => 0.002 * l[0]!);
    const small = crossSectionFit(loadings, y, 0.01)!.coefficients[0]!;
    const big = crossSectionFit(loadings, y, 1e6)!.coefficients[0]!;
    expect(Math.abs(big)).toBeLessThan(Math.abs(small));
  });

  it("returns null with too few stocks or identical exposures", () => {
    expect(crossSectionFit([[1, 2, 3]], [0.01])).toBeNull();
    const same = Array.from({ length: 20 }, () => [1, 1]);
    expect(crossSectionFit(same, new Array(20).fill(0.01), 0)).toBeNull();
  });

  it("rejects mismatched lengths", () => {
    expect(() => crossSectionFit([[1]], [1, 2])).toThrow("length");
  });
});

describe("attributeToFactors", () => {
  const loadings = [
    [2, 0],
    [0, -1],
    [1, 1],
  ];
  const daily = [
    { intercept: 0.001, coefficients: [0.002, 0.004], holdingReturns: [0.012, -0.002, 0.009] },
    { intercept: -0.002, coefficients: [-0.001, 0.003], holdingReturns: [-0.005, 0.001, 0.0] },
  ];

  it("splits the return by force, and the parts always add to the total", () => {
    const a = attributeToFactors([0.5, 0.25, 0.25], loadings, daily);
    // net exposures: force 0 = 0.5*2 + 0.25*1 = 1.25; force 1 = -0.25 + 0.25 = 0
    close(a.byFactor[0]!, 1.25 * (0.002 - 0.001));
    close(a.byFactor[1]!, 0);
    close(a.market, 0.001 - 0.002);
    const total =
      0.5 * 0.012 + 0.25 * -0.002 + 0.25 * 0.009 + (0.5 * -0.005 + 0.25 * 0.001 + 0.25 * 0);
    close(a.total, total);
    close(a.byFactor[0]! + a.byFactor[1]! + a.market + a.residual, a.total);
  });

  it("normalises weights that do not sum to one", () => {
    const a = attributeToFactors([2, 1, 1], loadings, daily);
    const b = attributeToFactors([0.5, 0.25, 0.25], loadings, daily);
    close(a.total, b.total);
    close(a.byFactor[0]!, b.byFactor[0]!);
  });

  it("has a zero residual when returns follow the fit exactly", () => {
    const l = [[1], [3]];
    const c = 0.002;
    const d = [
      { intercept: 0.001, coefficients: [c], holdingReturns: [0.001 + c * 1, 0.001 + c * 3] },
    ];
    close(attributeToFactors([0.5, 0.5], l, d).residual, 0);
  });

  it("rejects empty weights", () => {
    expect(() => attributeToFactors([0, 0], [[1], [1]], [])).toThrow("weights");
  });
});
