import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  factorConcentration,
  factorLoadings,
  pairOverlaps,
  type HoldingExposure,
} from "./index";

// Hand-written test fixtures, not real exposure data.
const holdings: HoldingExposure[] = [
  { ticker: "NVDA", weight: 0.5, exposures: { ai: 3, taiwan: 2, rates: -1 } },
  { ticker: "AAPL", weight: 0.3, exposures: { taiwan: 2, consumer: 2, rates: -1 } },
  { ticker: "XOM", weight: 0.2, exposures: { oil: 3, rates: 1 } },
];

const close = (a: number | null, b: number, tol = 1e-12) =>
  expect(Math.abs((a ?? NaN) - b)).toBeLessThan(tol);

describe("factorLoadings", () => {
  const loadings = factorLoadings(holdings);
  const get = (s: string) => loadings.find((l) => l.slug === s)!;

  it("sums weight times signed exposure", () => {
    close(get("ai").net, 1.5);
    close(get("taiwan").net, 0.5 * 2 + 0.3 * 2);
    close(get("rates").net, -0.5 - 0.3 + 0.2);
  });

  it("keeps gross exposure when signs offset", () => {
    close(get("rates").gross, 0.5 + 0.3 + 0.2);
    expect(Math.abs(get("rates").net)).toBeLessThan(get("rates").gross);
  });

  it("lists contributions by size and sorts factors by absolute net loading", () => {
    expect(get("taiwan").contributions.map((c) => c.ticker)).toEqual(["NVDA", "AAPL"]);
    expect(loadings.map((l) => l.slug).slice(0, 2)).toEqual(["taiwan", "ai"]);
  });

  it("ignores zero exposures and handles an empty portfolio", () => {
    expect(factorLoadings([{ ticker: "Z", weight: 1, exposures: { a: 0 } }])).toEqual([]);
    expect(factorLoadings([])).toEqual([]);
  });

  it("is invariant to single-stock scaling of the profile identity", () => {
    const solo = factorLoadings([{ ticker: "NVDA", weight: 1, exposures: holdings[0]!.exposures }]);
    expect(Object.fromEntries(solo.map((l) => [l.slug, l.net]))).toEqual({
      ai: 3,
      taiwan: 2,
      rates: -1,
    });
  });

  it("flips sign when all exposure signs flip", () => {
    const flipped = holdings.map((h) => ({
      ...h,
      exposures: Object.fromEntries(Object.entries(h.exposures).map(([k, v]) => [k, -v])),
    }));
    for (const l of factorLoadings(flipped)) close(l.net, -get(l.slug).net);
  });
});

describe("factorConcentration", () => {
  it("computes HHI on normalized absolute net loadings", () => {
    const c = factorConcentration(factorLoadings(holdings));
    const nets = factorLoadings(holdings).map((l) => Math.abs(l.net));
    const total = nets.reduce((a, b) => a + b, 0);
    close(
      c.hhi,
      nets.reduce((a, n) => a + (n / total) ** 2, 0),
    );
    close(c.effectiveFactors, 1 / c.hhi!);
    close(c.topShare, Math.max(...nets) / total);
    close(
      c.shares.reduce((a, s) => a + s.share, 0),
      1,
    );
  });

  it("is 1 for a single factor and 1/F for F equal factors", () => {
    expect(
      factorConcentration(factorLoadings([{ ticker: "A", weight: 1, exposures: { x: 2 } }])).hhi,
    ).toBe(1);
    const even = factorConcentration(
      factorLoadings([{ ticker: "A", weight: 1, exposures: { x: 1, y: 1, z: 1, w: 1 } }]),
    );
    close(even.hhi, 0.25);
    close(even.effectiveFactors, 4);
  });

  it("returns nulls when net loadings all cancel", () => {
    const c = factorConcentration(
      factorLoadings([
        { ticker: "A", weight: 0.5, exposures: { x: 2 } },
        { ticker: "B", weight: 0.5, exposures: { x: -2 } },
      ]),
    );
    expect(c).toEqual({ hhi: null, effectiveFactors: null, topShare: null, shares: [] });
  });

  it("scales invariantly with weights (shares unchanged)", () => {
    const a = factorConcentration(factorLoadings(holdings));
    const b = factorConcentration(
      factorLoadings(holdings.map((h) => ({ ...h, weight: h.weight * 7 }))),
    );
    close(a.hhi, b.hhi!);
  });
});

describe("overlap", () => {
  it("computes cosine similarity and rejects zero vectors", () => {
    close(cosineSimilarity({ a: 1, b: 1 }, { a: 1, b: 1 }), 1);
    close(cosineSimilarity({ a: 1 }, { b: 1 }), 0);
    close(cosineSimilarity({ a: 1 }, { a: -1 }), -1);
    expect(cosineSimilarity({}, { a: 1 })).toBeNull();
  });

  it("separates shared exposures from offsetting ones and sorts by similarity", () => {
    const pairs = pairOverlaps(holdings);
    expect(pairs[0]).toMatchObject({ a: "NVDA", b: "AAPL" });
    expect(pairs[0]!.shared).toEqual(["rates", "taiwan"]);
    const nx = pairs.find((p) => p.a === "NVDA" && p.b === "XOM")!;
    expect(nx.offsetting).toEqual(["rates"]);
    expect(nx.shared).toEqual([]);
    expect(pairs).toHaveLength(3);
  });
});
