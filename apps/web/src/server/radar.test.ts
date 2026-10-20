import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  companies,
  eventTypes,
  newsArticles,
  newsClassifications,
  newsCompanyLinks,
  sessions,
} from "@portfolio-lab/db";
import { createTestDb } from "@portfolio-lab/db/testing";
import { seedDevCompanies } from "../../../../packages/db/src/seed/companies";
import { createPortfolio } from "./portfolios";
import { getMarketRadar } from "./radar";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let sid: string;
let portfolioId: string;
const now = new Date("2026-03-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const decay = (days: number) => 0.5 ** (days / 3);

let n = 0;
async function article(opts: {
  title: string;
  at: string;
  cluster?: number;
  links: [string, number][];
  cls?: { class: "fundamental" | "narrative" | "noise" | "unclear"; importance: number };
}) {
  n++;
  const [a] = await ctx.db
    .insert(newsArticles)
    .values({
      provider: "t",
      providerId: String(n),
      url: `https://news.example.com/${n}`,
      title: opts.title,
      publishedAt: new Date(opts.at),
      dedupeHash: `h${n}`,
      marketSession: "regular",
      sourceName: "Wire",
    })
    .returning();
  await ctx.db
    .update(newsArticles)
    .set({ clusterId: opts.cluster ?? a!.id })
    .where(eq(newsArticles.id, a!.id));
  for (const [t, score] of opts.links) {
    const [c] = await ctx.db.select().from(companies).where(eq(companies.ticker, t));
    await ctx.db
      .insert(newsCompanyLinks)
      .values({ articleId: a!.id, companyId: c!.id, method: "alias", score });
  }
  if (opts.cls) {
    const [et] = await ctx.db.select().from(eventTypes).limit(1);
    await ctx.db.insert(newsClassifications).values({
      articleId: a!.id,
      eventTypeId: et!.id,
      class: opts.cls.class,
      fundamentalImportance: opts.cls.importance,
      marketRelevance: 5,
      expectedPersistence: 5,
      mechanism: "m",
      confidence: 0.9,
      model: "m",
      promptVersion: "v",
      contentHash: `c${n}`,
    });
  }
  return a!.id;
}

beforeAll(async () => {
  ctx = await createTestDb();
  await seedDevCompanies(ctx.db);
  await ctx.db
    .insert(eventTypes)
    .values({ slug: "x", name: "X", defaultClass: "fundamental", definition: "d" });
  [{ id: sid }] = (await ctx.db.insert(sessions).values({}).returning()) as { id: string }[];
  const p = await createPortfolio(ctx.db, sid, {
    name: "Radar",
    normalize: false,
    holdings: [
      { ticker: "NVDA", weightPct: 25 },
      { ticker: "AAPL", weightPct: 20 },
      { ticker: "MSFT", weightPct: 55 },
    ],
  });
  portfolioId = p.id;

  await article({
    title: "A1 NVDA fundamental",
    at: hoursAgo(12),
    links: [["NVDA", 0.9]],
    cls: { class: "fundamental", importance: 8 },
  });
  const a2 = await article({
    title: "A2 AAPL narrative",
    at: hoursAgo(48),
    links: [["AAPL", 0.8]],
    cls: { class: "narrative", importance: 9 },
  });
  await article({
    title: "A2 AAPL narrative - Wire",
    at: hoursAgo(47),
    cluster: a2,
    links: [["AAPL", 0.8]],
  });
  await article({
    title: "A3 MSFT noise",
    at: hoursAgo(24),
    links: [["MSFT", 0.9]],
    cls: { class: "noise", importance: 2 },
  });
  await article({
    title: "A4 NVDA unclassified old",
    at: hoursAgo(24 * 6),
    links: [["NVDA", 0.9]],
  });
  await article({
    title: "A5 NVDA out of window",
    at: hoursAgo(24 * 10),
    links: [["NVDA", 0.9]],
    cls: { class: "fundamental", importance: 9 },
  });
  await article({ title: "A6 weak ambiguous link", at: hoursAgo(1), links: [["NVDA", 0.3]] });
  await article({ title: "A7 unheld company", at: hoursAgo(1), links: [["JPM", 0.95]] });
});
afterAll(async () => {
  await ctx.teardown();
});

describe("getMarketRadar", () => {
  it("ranks by relevance with scores that match a hand calculation, merging syndicated copies and excluding weak or unheld links", async () => {
    const r = await getMarketRadar(ctx.db, sid, portfolioId, { now });
    expect(r.items.map((i) => i.title)).toEqual([
      "A1 NVDA fundamental",
      "A2 AAPL narrative",
      "A3 MSFT noise",
      "A4 NVDA unclassified old",
    ]);

    const by = Object.fromEntries(r.items.map((i) => [i.title.slice(0, 2), i]));
    // A1: 0.9 link x full weight (0.25) x 0.8 impact x decay over half a day
    expect(by.A1!.relevance.score).toBeCloseTo(10 * 0.9 * 1 * 0.8 * decay(0.5), 10);
    // A2: 0.8 x (0.4 + 0.6 * 0.8) = 0.704 match, impact capped at 0.6 for narrative, two days old
    expect(by.A2!.relevance.score).toBeCloseTo(10 * 0.704 * 0.6 * decay(2), 10);
    expect(by.A2!.copies).toBe(1);
    // A4: unclassified so impact 0.5, six days old
    expect(by.A4!.relevance.score).toBeCloseTo(10 * 0.9 * 0.5 * decay(6), 10);
    expect(by.A4!.classification).toBeNull();
    // A3: MSFT is 55% of the portfolio (full weight), noise caps impact at 0.2
    expect(by.A3!.relevance.score).toBeCloseTo(10 * 0.9 * 0.2 * decay(1), 10);
    expect(by.A1!.relevance.matched).toEqual([
      { ticker: "NVDA", linkScore: 0.9, weight: 0.25, contribution: 0.9 },
    ]);
  });

  it("counts shown and collapsed items by the low-relevance threshold, and by class", async () => {
    const r = await getMarketRadar(ctx.db, sid, portfolioId, { now });
    expect(r.threshold).toBe(1);
    expect(r.counts.total).toBe(4);
    expect(r.counts.shown + r.counts.collapsed).toBe(4);
    expect(r.counts.shown).toBe(r.items.filter((i) => i.relevance.score >= 1).length);
    expect(r.counts.byClass).toEqual({ fundamental: 1, narrative: 1, noise: 1, unclassified: 1 });
  });

  it("widens with the days window", async () => {
    expect(
      (await getMarketRadar(ctx.db, sid, portfolioId, { now, days: 1 })).items.map((i) => i.title),
    ).toEqual(["A1 NVDA fundamental", "A3 MSFT noise"]);
    const wide = await getMarketRadar(ctx.db, sid, portfolioId, { now, days: 30 });
    expect(wide.items).toHaveLength(5);
    expect(wide.items.some((i) => i.title.startsWith("A5"))).toBe(true);
  });

  it("filters by class, including unclassified, and by holding", async () => {
    const titles = async (o: Parameters<typeof getMarketRadar>[3]) =>
      (await getMarketRadar(ctx.db, sid, portfolioId, { now, ...o })).items.map((i) =>
        i.title.slice(0, 2),
      );
    expect(await titles({ class: "noise" })).toEqual(["A3"]);
    expect(await titles({ class: "unclassified" })).toEqual(["A4"]);
    expect(await titles({ class: "unclear" })).toEqual([]);
    expect(await titles({ ticker: "NVDA" })).toEqual(["A1", "A4"]);
    expect(await titles({ ticker: "JPM" })).toEqual([]);
    expect(await titles({ ticker: "NVDA", class: "fundamental" })).toEqual(["A1"]);
  });

  it("returns an empty radar for a portfolio with no matching news, and hides other sessions", async () => {
    const [other] = await ctx.db.insert(sessions).values({}).returning();
    const quiet = await createPortfolio(ctx.db, other!.id, {
      name: "Quiet",
      normalize: false,
      holdings: [{ ticker: "AMZN", weightPct: 100 }],
    });
    const r = await getMarketRadar(ctx.db, other!.id, quiet.id, { now });
    expect(r).toMatchObject({
      items: [],
      counts: { total: 0, shown: 0, collapsed: 0, byClass: {} },
    });
    await expect(getMarketRadar(ctx.db, other!.id, portfolioId, { now })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("works without price history because it only needs holdings", async () => {
    // No prices were inserted anywhere in this test database.
    const r = await getMarketRadar(ctx.db, sid, portfolioId, { now });
    expect(r.items.length).toBeGreaterThan(0);
  });
});
