import { describe, expect, it } from "vitest";
import {
  FULL_VULNERABILITY_LOSS,
  PERCENT_PER_POINT,
  stress,
  vulnerabilityScore,
  type StressHolding,
} from "./index";

const close = (a: number, b: number, tol = 1e-12) => expect(Math.abs(a - b)).toBeLessThan(tol);

const holdings: StressHolding[] = [
  {
    ticker: "NVDA",
    weight: 0.5,
    exposures: { rates: { signed: -1, confidence: 0.8 }, ai: { signed: 3, confidence: 0.9 } },
  },
  { ticker: "AAPL", weight: 0.3, exposures: { rates: { signed: -1, confidence: 0.6 } } },
  { ticker: "JPM", weight: 0.2, exposures: { rates: { signed: 2, confidence: 0.7 } } },
];

describe("stress", () => {
  it("matches a hand calculation for a full-size rate rise", () => {
    // impacts: NVDA -1*0.03, AAPL -1*0.03, JPM +2*0.03; contributions -0.015, -0.009, +0.012
    const r = stress(holdings, { rates: 1 });
    close(r.portfolioImpact, -0.015 - 0.009 + 0.012);
    const by = Object.fromEntries(r.holdings.map((h) => [h.ticker, h]));
    close(by.NVDA!.impact, -PERCENT_PER_POINT);
    close(by.JPM!.impact, 2 * PERCENT_PER_POINT);
    close(by.AAPL!.contribution, -0.009);
    expect(r.touched).toBe(true);
    expect(r.factors).toEqual([{ slug: "rates", contribution: expect.closeTo(-0.012, 12) }]);
  });

  it("scales linearly with the shock size and flips sign for the opposite shock", () => {
    const full = stress(holdings, { rates: 1 }).portfolioImpact;
    close(stress(holdings, { rates: 0.5 }).portfolioImpact, full / 2);
    close(stress(holdings, { rates: -1 }).portfolioImpact, -full);
    close(stress(holdings, { rates: 0 }).portfolioImpact, 0);
  });

  it("adds the effect of several shocked factors and orders holdings from worst to best", () => {
    const r = stress(holdings, { rates: 1, ai: -1 });
    close(r.portfolioImpact, -0.012 + 0.5 * 3 * -1 * PERCENT_PER_POINT);
    expect(r.holdings.map((h) => h.ticker)).toEqual(["NVDA", "AAPL", "JPM"]);
    expect(r.factors.map((f) => f.slug)).toEqual(["ai", "rates"]); // largest effect first
  });

  it("weights reliability by how much each exposure matters", () => {
    // |contributions|: NVDA 0.015 (conf 0.8), AAPL 0.009 (0.6), JPM 0.012 (0.7)
    close(
      stress(holdings, { rates: 1 }).reliability!,
      (0.015 * 0.8 + 0.009 * 0.6 + 0.012 * 0.7) / (0.015 + 0.009 + 0.012),
    );
  });

  it("reports nothing touched, with zero impact and no reliability, when no holding has the shocked factor", () => {
    const r = stress(holdings, { oil: 1 });
    expect(r).toMatchObject({ portfolioImpact: 0, touched: false, reliability: null, factors: [] });
    expect(r.holdings.every((h) => h.impact === 0)).toBe(true);
    expect(stress([], { rates: 1 }).touched).toBe(false);
  });

  it("ignores zero exposures", () => {
    const h: StressHolding[] = [
      { ticker: "Z", weight: 1, exposures: { rates: { signed: 0, confidence: 1 } } },
    ];
    expect(stress(h, { rates: 1 }).touched).toBe(false);
  });
});

describe("vulnerabilityScore", () => {
  it("maps a loss to 0-10, capped, and scores gains as zero", () => {
    close(vulnerabilityScore(-0.05), 5);
    close(vulnerabilityScore(-FULL_VULNERABILITY_LOSS), 10);
    expect(vulnerabilityScore(-0.5)).toBe(10);
    expect(vulnerabilityScore(0.04)).toBe(0);
    expect(vulnerabilityScore(0)).toBe(0);
  });
});
