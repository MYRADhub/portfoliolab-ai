import { describe, expect, it } from "vitest";
import { impactOf, recencyOf, scoreRelevance, weightFactor } from "./index";

const close = (a: number, b: number, tol = 1e-12) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe("weightFactor", () => {
  it("counts a large holding fully and a small one down to 40%", () => {
    close(weightFactor(0.25), 1);
    close(weightFactor(0.5), 1);
    close(weightFactor(0), 0.4);
    close(weightFactor(0.125), 0.7);
    close(weightFactor(-1), 0.4);
  });
});

describe("impactOf", () => {
  it("scales with importance and is capped by class", () => {
    close(impactOf({ class: "fundamental", fundamentalImportance: 8 }), 0.8);
    close(impactOf({ class: "narrative", fundamentalImportance: 9 }), 0.6);
    close(impactOf({ class: "noise", fundamentalImportance: 9 }), 0.2);
    close(impactOf({ class: "unclear", fundamentalImportance: 10 }), 0.3);
  });

  it("never falls below 0.1 for low-importance news and is neutral when unclassified", () => {
    close(impactOf({ class: "fundamental", fundamentalImportance: 0 }), 0.1);
    close(impactOf(null), 0.5);
  });
});

describe("recencyOf", () => {
  it("halves every three days and treats future dates as fresh", () => {
    close(recencyOf(0), 1);
    close(recencyOf(3), 0.5);
    close(recencyOf(6), 0.25);
    close(recencyOf(-2), 1);
  });
});

describe("scoreRelevance", () => {
  const nvda = { ticker: "NVDA", linkScore: 0.9, weight: 0.25 };

  it("matches a hand-computed example: 0.9 link x full weight x 0.8 impact x fresh = 7.2", () => {
    const r = scoreRelevance({
      links: [nvda],
      classification: { class: "fundamental", fundamentalImportance: 8 },
      ageDays: 0,
    });
    close(r.score, 7.2);
    close(r.exposureMatch, 0.9);
    close(r.impact, 0.8);
    close(r.recency, 1);
    expect(r.matched).toEqual([
      { ticker: "NVDA", linkScore: 0.9, weight: 0.25, contribution: 0.9 },
    ]);
  });

  it("decays with age: the same article three days old scores half", () => {
    const r = scoreRelevance({
      links: [nvda],
      classification: { class: "fundamental", fundamentalImportance: 8 },
      ageDays: 3,
    });
    close(r.score, 3.6);
  });

  it("combines several affected holdings so more exposure scores higher, below certainty", () => {
    const one = scoreRelevance({
      links: [nvda],
      classification: { class: "fundamental", fundamentalImportance: 10 },
      ageDays: 0,
    });
    const two = scoreRelevance({
      links: [nvda, { ticker: "AAPL", linkScore: 0.8, weight: 0.2 }],
      classification: { class: "fundamental", fundamentalImportance: 10 },
      ageDays: 0,
    });
    // AAPL: 0.8 * (0.4 + 0.6 * 0.8) = 0.704; match = 1 - 0.1 * 0.296 = 0.9704
    close(two.exposureMatch, 1 - (1 - 0.9) * (1 - 0.704));
    expect(two.score).toBeGreaterThan(one.score);
    expect(two.score).toBeLessThan(10);
  });

  it("a tiny holding matters less than a big one for the same story", () => {
    const big = scoreRelevance({
      links: [{ ...nvda, weight: 0.4 }],
      classification: null,
      ageDays: 0,
    });
    const small = scoreRelevance({
      links: [{ ...nvda, weight: 0.02 }],
      classification: null,
      ageDays: 0,
    });
    expect(big.score).toBeGreaterThan(small.score);
    close(small.exposureMatch, 0.9 * (0.4 + 0.6 * 0.08));
  });

  it("ranks real economic news above gossip and an unclassified item in between, for the same holdings", () => {
    const score = (c: Parameters<typeof scoreRelevance>[0]["classification"]) =>
      scoreRelevance({ links: [nvda], classification: c, ageDays: 0 }).score;
    const real = score({ class: "fundamental", fundamentalImportance: 8 });
    const unknown = score(null);
    const gossip = score({ class: "noise", fundamentalImportance: 2 });
    expect(real).toBeGreaterThan(unknown);
    expect(unknown).toBeGreaterThan(gossip);
    close(gossip, 10 * 0.9 * 0.2);
  });

  it("scores zero without any matched holding", () => {
    expect(scoreRelevance({ links: [], classification: null, ageDays: 0 })).toMatchObject({
      score: 0,
      exposureMatch: 0,
    });
  });
});
