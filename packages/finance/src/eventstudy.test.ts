import { describe, expect, it } from "vitest";
import { aggregate, fitMarketModel, reactionZ, studyEvent, type EventStudyInput } from "./index";

const close = (a: number, b: number, tol = 1e-12) => expect(Math.abs(a - b)).toBeLessThan(tol);

// Deterministic noise so the tests are repeatable.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
}

function synthetic(opts: {
  days: number;
  eventAt: number;
  shock: number;
  noise: number;
  alpha: number;
  beta: number;
}) {
  const r = rng(7);
  const market = Array.from({ length: opts.days }, () => r() * 0.02);
  const q = rng(11);
  const stock = market.map(
    (m, i) => opts.alpha + opts.beta * m + q() * opts.noise + (i === opts.eventAt ? opts.shock : 0),
  );
  const dates = Array.from({ length: opts.days }, (_, i) => `d${String(i).padStart(4, "0")}`);
  return { dates, stock, market } satisfies Omit<EventStudyInput, "eventDate">;
}

describe("fitMarketModel", () => {
  it("matches a hand-computed regression", () => {
    // x = 1..4, y = 2,4,5,8: beta 1.9, alpha 0, residuals 0.1 0.2 -0.7 0.4, sigma = sqrt(0.7 / 2)
    const m = fitMarketModel([2, 4, 5, 8], [1, 2, 3, 4], 3)!;
    close(m.beta, 1.9);
    close(m.alpha, 0);
    close(m.sigma, Math.sqrt(0.35));
    expect(m.n).toBe(4);
  });

  it("recovers exact parameters from noise-free data", () => {
    const x = [0.01, -0.02, 0.03, 0.005, -0.01];
    const m = fitMarketModel(
      x.map((v) => 0.001 + 1.5 * v),
      x,
      3,
    )!;
    close(m.alpha, 0.001);
    close(m.beta, 1.5);
    close(m.sigma, 0, 1e-12);
  });

  it("returns null with too little data or a market that never moves, and rejects mismatched lengths", () => {
    expect(fitMarketModel([1, 2], [1, 2])).toBeNull();
    expect(fitMarketModel([1, 2, 3, 4], [5, 5, 5, 5], 3)).toBeNull();
    expect(() => fitMarketModel([1, 2, 3], [1, 2], 3)).toThrow();
  });
});

describe("studyEvent", () => {
  const base = { days: 400, eventAt: 300, shock: 0.05, noise: 0.01, alpha: 0.0002, beta: 1.2 };

  it("recovers beta and detects a planted +5% shock on the event day", () => {
    const s = synthetic(base);
    const r = studyEvent({ ...s, eventDate: s.dates[300]! });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Math.abs(r.model.beta - 1.2)).toBeLessThan(0.3);
    const ar0 = r.ar.find((a) => a.offset === 0)!.value;
    expect(Math.abs(ar0 - 0.05)).toBeLessThan(0.02);
    expect(r.car.map((c) => c.horizon)).toEqual([0, 1, 5, 10, 30]);
    expect(r.car[0]!.t!).toBeGreaterThan(3);
    // later days add only noise, so CAR stays near the shock
    expect(Math.abs(r.car[3]!.value - 0.05)).toBeLessThan(0.05);
  });

  it("finds nothing when no shock is planted", () => {
    const s = synthetic({ ...base, shock: 0 });
    const r = studyEvent({ ...s, eventDate: s.dates[300]! });
    expect(r.ok && Math.abs(r.car[0]!.t!)).toBeLessThan(3);
  });

  it("never uses the event window to fit the model (no look-ahead)", () => {
    const a = synthetic(base);
    const b = synthetic({ ...base, shock: 0.5 }); // a much larger shock must not change the fitted model
    const ra = studyEvent({ ...a, eventDate: a.dates[300]! });
    const rb = studyEvent({ ...b, eventDate: b.dates[300]! });
    if (!ra.ok || !rb.ok) throw new Error("expected ok");
    close(ra.model.beta, rb.model.beta);
    close(ra.model.sigma, rb.model.sigma);
  });

  it("matches the hand formula for CAR and its t-statistic", () => {
    const s = synthetic(base);
    const r = studyEvent({ ...s, eventDate: s.dates[300]! });
    if (!r.ok) throw new Error("expected ok");
    const e = 300;
    const ab = (i: number) => s.stock[i]! - (r.model.alpha + r.model.beta * s.market[i]!);
    close(r.car[1]!.value, ab(e) + ab(e + 1));
    close(r.car[1]!.t!, r.car[1]!.value / (r.model.sigma * Math.sqrt(2)));
  });

  it("truncates horizons that have not happened yet", () => {
    const s = synthetic({ ...base, days: 303 });
    const r = studyEvent({ ...s, eventDate: s.dates[300]! });
    if (!r.ok) throw new Error("expected ok");
    expect(r.car.map((c) => c.horizon)).toEqual([0, 1]);
  });

  it("reports why a study is impossible", () => {
    const s = synthetic(base);
    expect(studyEvent({ ...s, eventDate: "nope" })).toEqual({ ok: false, reason: "no_event_day" });
    expect(studyEvent({ ...s, eventDate: s.dates[50]! })).toEqual({
      ok: false,
      reason: "short_history",
    });
    const flat = { ...s, market: s.market.map(() => 0.001) };
    expect(studyEvent({ ...flat, eventDate: s.dates[300]! })).toEqual({
      ok: false,
      reason: "flat_market",
    });
  });
});

describe("reactionZ", () => {
  it("scales by normal noise and is null without noise", () => {
    close(reactionZ(0.03, 0.01)!, 3);
    expect(reactionZ(0.03, 0)).toBeNull();
  });
});

describe("aggregate", () => {
  it("computes mean, t and a reproducible interval containing the mean", () => {
    const v = [0.02, 0.01, -0.005, 0.03, 0.015, 0.0];
    const a = aggregate(v, 3);
    close(a.mean, 0.0116666666667, 1e-9);
    expect(a.t).toBeCloseTo(a.mean / (a.sd! / Math.sqrt(6)), 12);
    expect(a.ci[0]).toBeLessThan(a.mean);
    expect(a.ci[1]).toBeGreaterThan(a.mean);
    expect(aggregate(v, 3)).toEqual(a);
    expect(a.sufficient).toBe(true);
  });

  it("collapses the interval for identical values and flags small samples", () => {
    const a = aggregate([0.01, 0.01, 0.01]);
    expect(a.ci).toEqual([0.01, 0.01]);
    expect(a.t).toBeNull();
    expect(a.sufficient).toBe(false);
    expect(aggregate([0.02]).sd).toBeNull();
    expect(() => aggregate([])).toThrow();
  });
});
