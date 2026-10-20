import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { companies, llmRuns, pricesDaily, sessions } from "@portfolio-lab/db";
import { createTestDb } from "@portfolio-lab/db/testing";
import type { ExplainGenerator, RawExplanation } from "@portfolio-lab/explain";
import { seedDevCompanies } from "../../../../packages/db/src/seed/companies";
import { createPortfolio } from "./portfolios";
import { buildPortfolioFacts, DISCLAIMER, getExplanation } from "./explain";
import { RateLimiter } from "./rate-limit";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let sid: string;
let portfolioId: string;
const now = new Date("2024-06-28T00:00:00Z");

function weekdays(from: string, n: number): string[] {
  const out: string[] = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    out.length < n;
    d = new Date(d.getTime() + 86_400_000)
  ) {
    if (![0, 6].includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function insertPrices(ticker: string, dates: string[], returns: number[]) {
  const [c] = await ctx.db.select().from(companies).where(eq(companies.ticker, ticker));
  let p = 100;
  await ctx.db.insert(pricesDaily).values(
    dates.map((date, i) => {
      if (i > 0) p *= 1 + returns[i - 1]!;
      return { companyId: c!.id, date, close: p, adjClose: p };
    }),
  );
}

class FakeGenerator implements ExplainGenerator {
  readonly model = "fake";
  calls = 0;
  constructor(private readonly make: (n: number) => RawExplanation) {}
  async generate() {
    this.calls++;
    return this.make(this.calls);
  }
}

const ungrounded: RawExplanation = { summary: "It returned about 99.9% [F6].", highlights: [] };

beforeAll(async () => {
  ctx = await createTestDb();
  await seedDevCompanies(ctx.db);
  [{ id: sid }] = (await ctx.db.insert(sessions).values({}).returning()) as { id: string }[];
  const dates = weekdays("2024-02-01", 100);
  const a = dates.slice(1).map((_, i) => 0.01 * Math.sin(i * 1.3) + 0.002);
  const b = dates.slice(1).map((_, i) => 0.01 * Math.cos(i * 0.37 + 1));
  await insertPrices("NVDA", dates, a);
  await insertPrices("AAPL", dates, b);
  const p = await createPortfolio(ctx.db, sid, {
    name: "Explain",
    normalize: false,
    holdings: [
      { ticker: "NVDA", weightPct: 60 },
      { ticker: "AAPL", weightPct: 40 },
    ],
  });
  portfolioId = p.id;
});
afterAll(async () => {
  await ctx.teardown();
});

describe("buildPortfolioFacts", () => {
  it("produces numbered facts with exact formatted values and the stated method", async () => {
    const facts = await buildPortfolioFacts(ctx.db, sid, portfolioId, now);
    const by = Object.fromEntries(facts.map((f) => [f.label, f]));
    expect(facts.map((f) => f.id)).toEqual(facts.map((_, i) => `F${i + 1}`));
    expect(by["Number of holdings"]!.text).toBe("2 holdings");
    expect(by["Largest holding"]!.text).toBe("NVDA 60.0%");
    expect(by["Method"]!.text).toContain("rebalanced daily");
    expect(by["Analysis window"]!.text).toMatch(
      /^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2} \(100 trading days\)$/,
    );
    expect(by["Total return"]!.text).toMatch(/^[+-]\d+\.\d%$/);
    expect(by["Average pairwise correlation (1 year)"]).toBeDefined();
    expect(by["Most correlated pair"]!.text).toMatch(/^(AAPL and NVDA|NVDA and AAPL) -?\d\.\d\d$/);
    expect(by["Effective number of sectors"]).toBeUndefined(); // no exposure data loaded
  });

  it("is deterministic", async () => {
    expect(await buildPortfolioFacts(ctx.db, sid, portfolioId, now)).toEqual(
      await buildPortfolioFacts(ctx.db, sid, portfolioId, now),
    );
  });

  it("hides another session's portfolio", async () => {
    const [other] = await ctx.db.insert(sessions).values({}).returning();
    await expect(buildPortfolioFacts(ctx.db, other!.id, portfolioId, now)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("getExplanation", () => {
  const grounded = (): RawExplanation => ({
    summary: "The portfolio has 2 holdings [F3].",
    highlights: [],
  });

  it("returns a grounded explanation with the disclaimer, then serves repeats from cache without calling the model", async () => {
    const g = new FakeGenerator(grounded);
    const limiter = new RateLimiter(ctx.db, 5, 60_000);
    const first = await getExplanation(ctx.db, sid, portfolioId, g, { now, limiter });
    expect(first).toMatchObject({
      cached: false,
      disclaimer: DISCLAIMER,
      explanation: { source: "model" },
    });
    const second = await getExplanation(ctx.db, sid, portfolioId, g, { now, limiter });
    expect(second).toMatchObject({ cached: true, explanation: { source: "model" } });
    expect(g.calls).toBe(1);
    expect(
      await ctx.db.select().from(llmRuns).where(eq(llmRuns.purpose, "portfolio_explanation")),
    ).toHaveLength(1);
  });

  it("falls back, and does not cache, when the model cannot be grounded", async () => {
    const [other] = await ctx.db.insert(sessions).values({}).returning();
    const p = await createPortfolio(ctx.db, other!.id, {
      name: "Other",
      normalize: false,
      holdings: [{ ticker: "NVDA", weightPct: 100 }],
    });
    const g = new FakeGenerator(() => ungrounded);
    const r = await getExplanation(ctx.db, other!.id, p.id, g, {
      now,
      limiter: new RateLimiter(ctx.db, 5, 60_000),
    });
    expect(r.explanation.source).toBe("fallback");
    expect(r.explanation.summary).not.toContain("99.9");
    expect(g.calls).toBe(2); // one attempt plus one retry
    const again = await getExplanation(ctx.db, other!.id, p.id, g, {
      now,
      limiter: new RateLimiter(ctx.db, 5, 60_000),
    });
    expect(again.cached).toBe(false);
  });

  it("rate limits uncached requests per session but not cache hits", async () => {
    let t = new Date("2026-01-01T00:00:00Z");
    const limiter = new RateLimiter(ctx.db, 1, 1000, () => t);
    const [s2] = await ctx.db.insert(sessions).values({}).returning();
    const p = await createPortfolio(ctx.db, s2!.id, {
      name: "RL",
      normalize: false,
      holdings: [{ ticker: "AAPL", weightPct: 100 }],
    });
    const g = new FakeGenerator(() => ({ summary: "There is 1 holding [F3].", highlights: [] }));
    await getExplanation(ctx.db, s2!.id, p.id, g, { now, limiter });
    // The same facts are served from cache even though the limiter is exhausted.
    expect((await getExplanation(ctx.db, s2!.id, p.id, g, { now, limiter })).cached).toBe(true);
    // A different portfolio would need a model call and is rejected.
    const p2 = await createPortfolio(ctx.db, s2!.id, {
      name: "RL2",
      normalize: false,
      holdings: [{ ticker: "NVDA", weightPct: 100 }],
    });
    await expect(getExplanation(ctx.db, s2!.id, p2.id, g, { now, limiter })).rejects.toMatchObject({
      code: "rate_limited",
    });
    t = new Date("2026-01-01T00:00:02Z");
    await expect(getExplanation(ctx.db, s2!.id, p2.id, g, { now, limiter })).resolves.toBeDefined();
  });
});

describe("RateLimiter", () => {
  it("allows up to max per window, forgets old hits, and tracks keys separately", async () => {
    let t = new Date("2026-01-01T00:00:00Z");
    const l = new RateLimiter(ctx.db, 2, 100, () => t);
    expect([
      await l.tryAcquire("a"),
      await l.tryAcquire("a"),
      await l.tryAcquire("a"),
      await l.tryAcquire("b"),
    ]).toEqual([true, true, false, true]);
    t = new Date(t.getTime() + 101);
    expect(await l.tryAcquire("a")).toBe(true);
  });

  it("does not let concurrent requests exceed the limit", async () => {
    const l = new RateLimiter(ctx.db, 3, 60_000);
    const results = await Promise.all(Array.from({ length: 10 }, () => l.tryAcquire("race")));
    expect(results.filter(Boolean)).toHaveLength(3);
  });

  it("shares state between limiter instances, as separate servers would", async () => {
    const a = new RateLimiter(ctx.db, 1, 60_000);
    const b = new RateLimiter(ctx.db, 1, 60_000);
    expect(await a.tryAcquire("shared")).toBe(true);
    expect(await b.tryAcquire("shared")).toBe(false);
  });
});
