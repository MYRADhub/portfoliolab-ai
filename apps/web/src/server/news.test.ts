import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Classifier } from "@portfolio-lab/classify";
import { syncAliases, type WebNewsResult } from "@portfolio-lab/data";
import {
  benchmarkPrices,
  companies,
  holdings,
  portfolios,
  pricesDaily,
  sessions,
} from "@portfolio-lab/db";
import { createTestDb } from "@portfolio-lab/db/testing";
import { getNewsAnalysis, eventReturns } from "./news-analysis";
import { scanPortfolioNews } from "./news-scan";
import { getMarketRadar } from "./radar";
import { RateLimiter } from "./rate-limit";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let sid: string;
let other: string;
let pid: string;
// Saturday 2026-10-31: stories from "2 days ago" are Thursday 10-29 (a trading day).
const now = new Date("2026-10-31T18:00:00Z");

beforeAll(async () => {
  ctx = await createTestDb();
  const s = await ctx.db.insert(sessions).values([{}, {}]).returning();
  sid = s[0]!.id;
  other = s[1]!.id;
  const [a, b] = await ctx.db
    .insert(companies)
    .values([
      { ticker: "AAA", name: "Alpha Chips Inc", sector: "Information Technology" },
      { ticker: "BBB", name: "Beta Banks Corp", sector: "Financials" },
    ])
    .returning();
  await syncAliases(ctx.db);
  const days = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];
  // AAA: 100, 100, 100, 110 (+10% on 10-29), 121 (+10%); SPY: +1% on 10-29, +0% after.
  const aaa = [100, 100, 100, 110, 121];
  const spy = [500, 500, 500, 505, 505];
  await ctx.db.insert(pricesDaily).values(
    days.flatMap((d, i) => [
      { companyId: a!.id, date: d, close: 1, adjClose: aaa[i]! },
      { companyId: b!.id, date: d, close: 1, adjClose: 50 },
    ]),
  );
  await ctx.db
    .insert(benchmarkPrices)
    .values(days.map((d, i) => ({ symbol: "SPY", date: d, adjClose: spy[i]! })));
  const [p] = await ctx.db.insert(portfolios).values({ sessionId: sid, name: "Mine" }).returning();
  pid = p!.id;
  await ctx.db.insert(holdings).values([
    { portfolioId: pid, companyId: a!.id, weight: 0.6 },
    { portfolioId: pid, companyId: b!.id, weight: 0.4 },
  ]);
});
afterAll(async () => {
  await ctx.teardown();
});

const unlimited = () => new RateLimiter(ctx.db, 1000, 60_000);

const results: Record<string, WebNewsResult[]> = {
  AAA: [
    {
      title: "Alpha Chips raises full-year revenue guidance",
      url: "https://www.reuters.com/alpha-guidance",
      snippet: "Alpha Chips Inc said revenue would beat its earlier outlook.",
      published: "2 days ago",
    },
    {
      title: "Alpha Chips raises full year revenue guidance",
      url: "https://apnews.com/alpha-guidance",
      snippet: "The chipmaker Alpha Chips lifted its forecast.",
      published: "2 days ago",
    },
    {
      title: "Alpha Chips company profile",
      url: "https://example.com/profile",
      snippet: "An undated profile page.",
    },
  ],
  BBB: [],
};

const classifier: Classifier & { calls: number } = {
  model: "fake-model",
  promptVersion: "cls-test",
  calls: 0,
  async classify() {
    this.calls++;
    return {
      status: "ok",
      output: {
        event_type: "earnings_beat",
        classification: "fundamental",
        fundamental_importance: 8,
        market_relevance: 7,
        expected_persistence: 6,
        mechanism: "Higher guidance raises expected earnings.",
        confidence: 0.9,
      },
      usage: { tokensIn: 1, tokensOut: 1, cacheReadTokens: 0 },
    };
  },
};

const deps = () => ({
  web: { search: async (q: string) => results[/\((\w+)\)/.exec(q)![1]!] ?? [] },
  feed: null,
  classifier,
});

describe("news scan", () => {
  it("stores dated web news, groups the same story across outlets, links by name and classifies it", async () => {
    const r = await scanPortfolioNews(ctx.db, sid, pid, deps(), { now, limiter: unlimited() });
    expect(r.providers).toEqual(["web"]);
    expect(r.tickers).toEqual(["AAA", "BBB"]);
    expect(r.range).toEqual({ from: "2026-10-24", to: "2026-10-31" });
    expect(r.fetched).toBe(2);
    expect(r.inserted).toBe(2);
    expect(r.linked).toBe(2);
    expect(r.classified).toBe(2);

    const radar = await getMarketRadar(ctx.db, sid, pid, { days: 7, now });
    expect(radar.items).toHaveLength(1);
    const item = radar.items[0]!;
    expect(item.copies).toBe(1);
    expect(item.outlets).toEqual(["reuters.com", "apnews.com"]);
    expect(item.classification?.class).toBe("fundamental");
    expect(radar.overview.byHolding).toEqual([{ key: "AAA", count: 1 }]);
    expect(radar.overview.byOutlet).toEqual([{ key: "reuters.com", count: 1 }]);
  });

  it("does not store or classify the same articles twice", async () => {
    const before = classifier.calls;
    const r = await scanPortfolioNews(ctx.db, sid, pid, deps(), { now, limiter: unlimited() });
    expect(r.inserted).toBe(0);
    expect(r.duplicates).toBe(2);
    expect(classifier.calls).toBe(before);
  });

  it("links an article that never names the company to the company it was searched for, weakly", async () => {
    const d = deps();
    const withBank = {
      ...d,
      web: {
        search: async (q: string) =>
          /\(BBB\)/.test(q)
            ? [
                {
                  title: "Regional lenders rally as deposit outflows ease",
                  url: "https://www.cnbc.com/lenders-rally",
                  snippet: "Bank shares rose after deposit data improved.",
                  published: "1 day ago",
                },
              ]
            : d.web.search(q),
      },
    };
    const r = await scanPortfolioNews(ctx.db, sid, pid, withBank, { now, limiter: unlimited() });
    expect(r.inserted).toBe(1);
    expect(r.searchLinked).toBe(1);
    expect(r.linked).toBe(1);
    const radar = await getMarketRadar(ctx.db, sid, pid, { days: 7, now });
    const bank = radar.items.find((i) => i.title.startsWith("Regional lenders"))!;
    expect(bank.relevance.matched.map((m) => [m.ticker, m.linkScore])).toEqual([["BBB", 0.55]]);
    const a = await getNewsAnalysis(ctx.db, sid, pid, bank.id, { now });
    expect(a.links[0]).toMatchObject({ ticker: "BBB", method: "web_search", ignored: false });
    expect(a.links[0]!.why).toMatch(/name was not matched/);
  });

  it("checks ownership, configuration and the hourly allowance", async () => {
    await expect(
      scanPortfolioNews(ctx.db, other, pid, deps(), { now, limiter: unlimited() }),
    ).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      scanPortfolioNews(
        ctx.db,
        sid,
        pid,
        { web: null, feed: null, classifier: null },
        { now, limiter: unlimited() },
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
    await expect(
      scanPortfolioNews(ctx.db, sid, pid, deps(), {
        now,
        limiter: new RateLimiter(ctx.db, 0, 60_000),
      }),
    ).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("news analysis", () => {
  it("explains coverage, links, classification, the score and the price reaction", async () => {
    const radar = await getMarketRadar(ctx.db, sid, pid, { days: 7, now });
    const item = radar.items[0]!;
    const a = await getNewsAnalysis(ctx.db, sid, pid, item.id, { now });

    expect(a.coverage.map((c) => c.source)).toEqual(["reuters.com", "apnews.com"]);
    expect(a.outlets).toBe(2);
    expect(a.links).toHaveLength(1);
    expect(a.links[0]).toMatchObject({
      ticker: "AAA",
      method: "alias",
      weight: 0.6,
      ignored: false,
    });
    expect(a.links[0]!.evidence.join(" ").toLowerCase()).toContain("alpha chips");

    expect(a.classifications[0]).toMatchObject({
      class: "fundamental",
      decidedBy: "ai",
      model: "fake-model",
      promptVersion: "cls-test",
      eventType: { slug: "earnings_beat" },
    });

    // Same score as the News page, and the last step states it.
    expect(a.relevance.score).toBeCloseTo(item.relevance.score, 10);
    expect(a.relevance.steps.at(-1)!.value).toBe(`${item.relevance.score.toFixed(1)} of 10`);
    expect(a.relevance.steps.map((s) => s.label)).toEqual([
      "AAA link",
      "Holdings touched",
      "Economic impact",
      "Freshness",
      "Relevance",
    ]);

    // Published Thursday 10-29 at 18:00 UTC (2 pm in New York, regular session): the reaction day is 10-29.
    expect(a.reactions).toHaveLength(1);
    const r = a.reactions[0]!;
    expect(r.tradingDate).toBe("2026-10-29");
    expect(r.stockDay).toBeCloseTo(0.1, 10);
    expect(r.marketDay).toBeCloseTo(0.01, 10);
    expect(r.excessDay).toBeCloseTo(0.09, 10);
    expect(r.stockTwoDay).toBeCloseTo(0.21, 10);
    expect(r.excessTwoDay).toBeCloseTo(0.2, 10);
  });

  it("is private to the portfolio's owner and reports missing stories", async () => {
    const radar = await getMarketRadar(ctx.db, sid, pid, { days: 7, now });
    await expect(
      getNewsAnalysis(ctx.db, other, pid, radar.items[0]!.id, { now }),
    ).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(getNewsAnalysis(ctx.db, sid, pid, 999999, { now })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("computes event returns and reports gaps", () => {
    const rows = [
      { date: "2026-10-28", close: 100 },
      { date: "2026-10-29", close: 110 },
    ];
    expect(eventReturns(rows, "2026-10-29")).toEqual({
      day: 0.10000000000000009,
      twoDay: null,
      date: "2026-10-29",
    });
    expect(eventReturns(rows, "2026-11-02")).toEqual({ day: null, twoDay: null, date: null });
    expect(eventReturns(rows, "2026-10-01").day).toBeNull();
  });
});
