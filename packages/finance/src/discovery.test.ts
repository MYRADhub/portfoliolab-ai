import { describe, expect, it } from "vitest";
import { exposureSimilarity, scoreCandidate, snapshot, type HoldingExposure } from "./index";

const close = (a: number, b: number, tol = 1e-12) => expect(Math.abs(a - b)).toBeLessThan(tol);

const portfolio: (HoldingExposure & { sector: string })[] = [
  { ticker: "NVDA", weight: 0.5, sector: "Tech", exposures: { ai: 3, taiwan: -3, rates: -1 } },
  { ticker: "AMD", weight: 0.5, sector: "Tech", exposures: { ai: 2, taiwan: -3 } },
];

describe("snapshot", () => {
  it("measures concentration by force and by sector, and renormalizes weights", () => {
    const s = snapshot(portfolio);
    expect(s.effectiveSectors).toBe(1);
    expect(s.topFactor!.slug).toBe("taiwan");
    // loadings: ai 2.5, taiwan -3, rates -0.5; shares of 6.0 total
    close(s.factorHhi!, (2.5 / 6) ** 2 + (3 / 6) ** 2 + (0.5 / 6) ** 2);
    close(s.effectiveFactors!, 1 / s.factorHhi!);
    expect(snapshot(portfolio.map((h) => ({ ...h, weight: h.weight * 4 }))).factorHhi).toBeCloseTo(
      s.factorHhi!,
      12,
    );
  });
});

describe("scoreCandidate", () => {
  it("shrinks total hidden exposure when the candidate leans against the dominant force", () => {
    const hedge = scoreCandidate(
      portfolio,
      { ticker: "GOLD", sector: "Materials", exposures: { taiwan: 3, rates: 2 } },
      0.2,
    );
    // gross loading 6.0 -> 3.8: the hedge cancels rates entirely, so fewer factors remain even though exposure fell
    close(hedge.before.grossLoading, 6);
    close(hedge.after.grossLoading, 3.8);
    close(hedge.deltaGrossLoading, -2.2);
    expect(hedge.deltaEffectiveFactors!).toBeLessThan(0);
    expect(hedge.offsets).toEqual(["rates", "taiwan"]);
    expect(hedge.after.effectiveSectors).toBeGreaterThan(hedge.before.effectiveSectors);
    expect(hedge.adds).toEqual(["taiwan", "rates"]);
  });

  it("shows a look-alike candidate concentrating the portfolio further", () => {
    const twin = scoreCandidate(
      portfolio,
      { ticker: "AVGO", sector: "Tech", exposures: { ai: 3, taiwan: -3 } },
      0.2,
    );
    expect(twin.offsets).toEqual([]);
    expect(twin.after.topFactor!.share).toBeGreaterThanOrEqual(twin.before.topFactor!.share - 1e-9);
    expect(twin.after.effectiveSectors).toBe(1);
  });

  it("scales existing holdings to make room and agrees with snapshot on the combined portfolio", () => {
    const c = { ticker: "X", sector: "Energy", exposures: { oil: 3 } };
    const r = scoreCandidate(portfolio, c, 0.25);
    const manual = snapshot([
      ...portfolio.map((h) => ({ ...h, weight: h.weight * 0.75 })),
      { ticker: "X", weight: 0.25, sector: "Energy", exposures: c.exposures },
    ]);
    close(r.after.factorHhi!, manual.factorHhi!);
    close(r.after.effectiveSectors, manual.effectiveSectors);
  });

  it("returns null deltas when nothing has exposures, and rejects silly weights", () => {
    const bare = [{ ticker: "A", weight: 1, sector: "S", exposures: {} }];
    expect(
      scoreCandidate(bare, { ticker: "B", sector: "S", exposures: {} }, 0.1).deltaEffectiveFactors,
    ).toBeNull();
    expect(() =>
      scoreCandidate(portfolio, { ticker: "B", sector: null, exposures: {} }, 0),
    ).toThrow();
    expect(() =>
      scoreCandidate(portfolio, { ticker: "B", sector: null, exposures: {} }, 1),
    ).toThrow();
  });
});

describe("exposureSimilarity", () => {
  it("is 1 for identical profiles, -1 for opposite ones, 0 for disjoint ones", () => {
    expect(exposureSimilarity({ a: 2, b: -1 }, { a: 2, b: -1 })).toBeCloseTo(1, 12);
    expect(exposureSimilarity({ a: 2, b: -1 }, { a: -2, b: 1 })).toBeCloseTo(-1, 12);
    expect(exposureSimilarity({ a: 2 }, { b: 3 })).toBe(0);
  });

  it("matches a hand calculation and is symmetric", () => {
    // (3*1 + 0) / (sqrt(9+16) * sqrt(1+4)) = 3 / (5 * sqrt 5)
    const x = exposureSimilarity({ a: 3, b: 4 }, { a: 1, c: 2 })!;
    expect(x).toBeCloseTo(3 / (5 * Math.sqrt(5)), 12);
    expect(exposureSimilarity({ a: 1, c: 2 }, { a: 3, b: 4 })).toBeCloseTo(x, 12);
  });

  it("returns null when either profile is empty", () => {
    expect(exposureSimilarity({}, { a: 1 })).toBeNull();
    expect(exposureSimilarity({ a: 0 }, { a: 1 })).toBeNull();
  });
});
