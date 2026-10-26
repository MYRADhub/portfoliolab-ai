import { describe, expect, it } from "vitest";
import { binaryKappa, raterAgreement, weightedKappa, type RatedCompany } from "./index";

const close = (a: number | null, b: number, tol = 1e-12) =>
  expect(Math.abs((a ?? NaN) - b)).toBeLessThan(tol);

describe("weightedKappa", () => {
  it("is 1 for perfect agreement and 0 when agreement equals chance", () => {
    close(
      weightedKappa([
        [-3, -3],
        [0, 0],
        [2, 2],
      ]),
      1,
    );
    close(
      weightedKappa(
        [
          [0, 0],
          [1, 1],
          [0, 1],
          [1, 0],
        ],
        [0, 1],
      ),
      0,
    );
  });

  it("matches a hand-worked three-category example", () => {
    // Observed weighted disagreement 0.1, expected 0.3, so kappa = 1 - 0.1 / 0.3.
    const pairs: [number, number][] = [
      [0, 0],
      [1, 1],
      [2, 2],
      [0, 1],
      [2, 1],
    ];
    close(weightedKappa(pairs, [0, 1, 2]), 2 / 3);
  });

  it("equals plain kappa on two categories", () => {
    const pairs: [number, number][] = [
      [0, 0],
      [0, 0],
      [1, 1],
      [0, 1],
    ];
    close(weightedKappa(pairs, [0, 1]), 0.5);
    close(binaryKappa(pairs.map(([a, b]) => [a === 1, b === 1])), 0.5);
  });

  it("punishes a sign error more than a near miss", () => {
    const base: [number, number][] = [
      [0, 0],
      [0, 0],
      [3, 3],
      [-3, -3],
      [1, 1],
    ];
    const near = weightedKappa([...base, [2, 3]])!;
    const flipped = weightedKappa([...base, [2, -2]])!;
    expect(near).toBeGreaterThan(flipped);
  });

  it("is undefined when every pair is in one category, and rejects off-scale scores", () => {
    expect(
      weightedKappa([
        [0, 0],
        [0, 0],
      ]),
    ).toBeNull();
    expect(weightedKappa([])).toBeNull();
    expect(() => weightedKappa([[4, 0]])).toThrow();
  });
});

describe("raterAgreement", () => {
  const forces = ["rates", "oil", "china"];
  const rated: RatedCompany[] = [
    { ticker: "A", ai: { rates: -2, oil: 1 }, human: { rates: -2 } },
    { ticker: "B", ai: { oil: 3 }, human: { oil: 3, china: 1 } },
    { ticker: "C", ai: { rates: 1 }, human: { rates: -1 } },
    { ticker: "D", ai: { china: 2 }, human: { china: 2 } },
  ];

  it("counts every company-force cell, treating an absent force as zero", () => {
    const r = raterAgreement(rated, forces, { resamples: 200 });
    expect(r.companies).toBe(4);
    expect(r.cells).toBe(12);
    // Mismatches: A.oil (1 vs 0), B.china (0 vs 1), C.rates (1 vs -1).
    close(r.exact, 9 / 12);
    close(r.meanAbsDiff, (1 + 1 + 2) / 12);
    expect(r.bothExposed).toBe(4); // A.rates, B.oil, C.rates, D.china
    close(r.signAgreement, 3 / 4);
    close(r.aiForcesPerCompany, 5 / 4);
    close(r.humanForcesPerCompany, 5 / 4);
  });

  it("breaks results down by force", () => {
    const r = raterAgreement(rated, forces, { resamples: 50 });
    const oil = r.byForce.find((f) => f.slug === "oil")!;
    expect(oil).toMatchObject({ aiExposed: 2, humanExposed: 1 });
    close(oil.presenceAgreement, 3 / 4);
    close(oil.meanAbsDiff, 1 / 4);
  });

  it("gives a reproducible interval that contains the point estimate", () => {
    const a = raterAgreement(rated, forces, { seed: 7, resamples: 500 });
    const b = raterAgreement(rated, forces, { seed: 7, resamples: 500 });
    expect(a.kappaInterval).toEqual(b.kappaInterval);
    const [lo, hi] = a.kappaInterval!;
    expect(lo).toBeLessThanOrEqual(a.weightedKappa!);
    expect(hi).toBeGreaterThanOrEqual(a.weightedKappa!);
  });

  it("handles no companies and a single company without an interval", () => {
    const none = raterAgreement([], forces);
    expect(none).toMatchObject({
      companies: 0,
      cells: 0,
      weightedKappa: null,
      kappaInterval: null,
    });
    const one = raterAgreement(rated.slice(0, 1), forces);
    expect(one.kappaInterval).toBeNull();
  });
});
