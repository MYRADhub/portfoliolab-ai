import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  companies,
  eventTypes,
  newsArticles,
  newsClassifications,
  newsCompanyLinks,
  pricesDaily,
  sessions,
} from "@portfolio-lab/db";
import { createTestDb } from "@portfolio-lab/db/testing";
import { checkGrounding, type ExplainGenerator, type RawExplanation } from "@portfolio-lab/explain";
import { seedDevCompanies } from "../../../../packages/db/src/seed/companies";
import { createPortfolio, getPortfolioAnalytics } from "./portfolios";
import { buildHeadline, buildMoveFacts, getPortfolioMove, moveTask, pp } from "./move";
import { getExplanation, getMoveExplanation } from "./explain";
import { RateLimiter } from "./rate-limit";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let sid: string;
let portfolioId: string;
const now = new Date("2024-06-28T00:00:00Z");
const holdingsOf = (pairs: [string, number][]) =>
  pairs.map(([ticker, weightPct]) => ({ ticker, weightPct }));

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

const dates = weekdays("2024-02-01", 100);
// A known bad day for technology: day index 90 (a Monday-ish date is looked up below).
const BAD = 90;
const returnsFor = (ticker: string): number[] =>
  dates.slice(1).map((_, i) => {
    if (i + 1 === BAD) return ticker === "NVDA" ? -0.04 : ticker === "AAPL" ? -0.02 : 0.005;
    return 0.001 * Math.sin(i * 0.7 + ticker.length);
  });

async function insertPrices(ticker: string) {
  const [c] = await ctx.db.select().from(companies).where(eq(companies.ticker, ticker));
  const r = returnsFor(ticker);
  let p = 100;
  await ctx.db.insert(pricesDaily).values(
    dates.map((date, i) => {
      if (i > 0) p *= 1 + r[i - 1]!;
      return { companyId: c!.id, date, close: p, adjClose: p };
    }),
  );
}

async function company(t: string) {
  return (await ctx.db.select().from(companies).where(eq(companies.ticker, t)))[0]!;
}

let nextProviderId = 0;
async function article(opts: {
  title: string;
  at: string;
  cluster?: number;
  links: [string, number][];
}) {
  const [a] = await ctx.db
    .insert(newsArticles)
    .values({
      provider: "t",
      providerId: String(nextProviderId++),
      url: `https://news.example.com/${nextProviderId}`,
      title: opts.title,
      publishedAt: new Date(opts.at),
      dedupeHash: `h${nextProviderId}`,
      marketSession: "regular",
      sourceName: "Wire",
    })
    .returning();
  await ctx.db
    .update(newsArticles)
    .set({ clusterId: opts.cluster ?? a!.id })
    .where(eq(newsArticles.id, a!.id));
  for (const [t, score] of opts.links) {
    await ctx.db
      .insert(newsCompanyLinks)
      .values({ articleId: a!.id, companyId: (await company(t)).id, method: "alias", score });
  }
  return a!.id;
}

beforeAll(async () => {
  ctx = await createTestDb();
  await seedDevCompanies(ctx.db);
  [{ id: sid }] = (await ctx.db.insert(sessions).values({}).returning()) as { id: string }[];
  for (const t of ["NVDA", "AAPL", "JPM"]) await insertPrices(t);
  const p = await createPortfolio(ctx.db, sid, {
    name: "Move",
    normalize: false,
    holdings: holdingsOf([
      ["NVDA", 50],
      ["AAPL", 30],
      ["JPM", 20],
    ]),
  });
  portfolioId = p.id;
});
afterAll(async () => {
  await ctx.teardown();
});

describe("getPortfolioMove", () => {
  it("splits the day's return into exact per-holding contributions that add up to the portfolio return", async () => {
    const date = dates[BAD]!;
    const m = await getPortfolioMove(ctx.db, sid, portfolioId, { date, now });
    const by = Object.fromEntries(m.holdings.map((h) => [h.ticker, h]));
    expect(by.NVDA!.assetReturn).toBeCloseTo(-0.04, 10);
    expect(by.NVDA!.contribution).toBeCloseTo(0.5 * -0.04, 12);
    expect(by.AAPL!.contribution).toBeCloseTo(0.3 * -0.02, 12);
    expect(by.JPM!.contribution).toBeCloseTo(0.2 * 0.005, 12);
    const sum = m.holdings.reduce((a, h) => a + h.contribution, 0);
    expect(m.portfolioReturn).toBeCloseTo(sum, 12);
    expect(m.portfolioReturn).toBeCloseTo(-0.02 - 0.006 + 0.001, 10);
    expect(m.previousDate).toBe(dates[BAD - 1]);
    // Largest effect first.
    expect(m.holdings.map((h) => h.ticker)).toEqual(["NVDA", "AAPL", "JPM"]);
  });

  it("agrees with the analytics equity curve for the same day", async () => {
    const a = await getPortfolioAnalytics(ctx.db, sid, portfolioId, { now });
    const m = await getPortfolioMove(ctx.db, sid, portfolioId, { date: dates[BAD]!, now });
    const i = a.equityCurve.findIndex((p) => p.date === dates[BAD]);
    expect(a.equityCurve[i]!.value / a.equityCurve[i - 1]!.value - 1).toBeCloseTo(
      m.portfolioReturn,
      10,
    );
  });

  it("groups by sector and writes a plain headline with the dominant sector's share", async () => {
    const m = await getPortfolioMove(ctx.db, sid, portfolioId, { date: dates[BAD]!, now });
    expect(m.groups.map((g) => g.group)).toEqual(["Information Technology", "Financials"]);
    const tech = m.groups[0]!;
    expect(tech.contribution).toBeCloseTo(-0.026, 10);
    expect(tech.share).toBeCloseTo(-0.026 / -0.025, 10);
    expect(m.groups[1]!.share).toBeCloseTo(0.001 / -0.025, 10); // moved against the portfolio
    // Technology fell by more than the whole net move because Financials rose, so the wording avoids "104%".
    expect(m.headline).toBe(
      "Information Technology holdings were the biggest drag at -2.60 percentage points, partly offset by moves in other sectors.",
    );
  });

  it("defaults to the latest day, lists recent choices newest first, and rejects other dates", async () => {
    const m = await getPortfolioMove(ctx.db, sid, portfolioId, { now });
    expect(m.date).toBe(dates.at(-1));
    expect(m.availableDates[0]).toBe(dates.at(-1));
    expect(m.availableDates).toHaveLength(30);
    await expect(
      getPortfolioMove(ctx.db, sid, portfolioId, { date: dates[0]!, now }),
    ).rejects.toMatchObject({ code: "bad_request" }); // no previous day
    await expect(
      getPortfolioMove(ctx.db, sid, portfolioId, { date: "2024-02-03", now }),
    ).rejects.toMatchObject({ code: "bad_request" }); // a Saturday
  });

  it("hides another session's portfolio", async () => {
    const [other] = await ctx.db.insert(sessions).values({}).returning();
    await expect(getPortfolioMove(ctx.db, other!.id, portfolioId, { now })).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("headline wording", () => {
  it("covers flat, concentrated and spread days", () => {
    expect(buildHeadline(0.0001, [{ group: "A", contribution: 0.0001, share: null }])).toBe(
      "The portfolio moved by less than 0.05% that day.",
    );
    expect(buildHeadline(0, [])).toBe("The portfolio moved by less than 0.05% that day.");
    expect(buildHeadline(0.02, [{ group: "Tech", contribution: 0.015, share: 0.75 }])).toBe(
      "About 75% of the day's gain came from Tech holdings.",
    );
    expect(
      buildHeadline(-0.02, [
        { group: "Tech", contribution: -0.008, share: 0.4 },
        { group: "Energy", contribution: -0.007, share: 0.35 },
      ]),
    ).toBe(
      "The decline was spread across sectors; the largest effect came from Tech holdings at -0.80 percentage points.",
    );
  });

  it("formats percentage points with a sign and two decimals", () => {
    expect([pp(0.0042), pp(-0.0042), pp(0)]).toEqual(["+0.42", "-0.42", "+0.00"]);
  });
});

describe("linked news", () => {
  const monday = dates.find((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1 && d > dates[60]!)!;
  const prevFriday = new Date(new Date(`${monday}T00:00:00Z`).getTime() - 3 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  beforeAll(async () => {
    const [guidance] = await ctx.db
      .insert(eventTypes)
      .values({
        slug: "guidance_cut",
        name: "Guidance cut",
        defaultClass: "fundamental",
        definition: "d",
      })
      .returning();
    // Two syndicated copies of one story on the day, same cluster.
    const first = await article({
      title: "Acme cuts outlook",
      at: `${monday}T14:00:00Z`,
      links: [["NVDA", 0.9]],
    });
    await article({
      title: "Acme cuts outlook - Wire",
      at: `${monday}T15:00:00Z`,
      cluster: first,
      links: [["NVDA", 0.8]],
    });
    await ctx.db.insert(newsClassifications).values({
      articleId: first,
      eventTypeId: guidance!.id,
      class: "fundamental",
      fundamentalImportance: 8,
      marketRelevance: 7,
      expectedPersistence: 8,
      mechanism: "Lower guided revenue.",
      confidence: 0.9,
      model: "m",
      promptVersion: "v",
      contentHash: "c",
    });
    // Friday after-hours news rolls to Monday.
    await article({
      title: "Friday evening report on Apple",
      at: `${prevFriday}T22:00:00Z`,
      links: [["AAPL", 0.8]],
    });
    // Excluded: weak ambiguous link, and an article from another day, and one about an unheld company.
    await article({
      title: "Target cuts forecast",
      at: `${monday}T14:00:00Z`,
      links: [["NVDA", 0.3]],
    });
    await article({ title: "Old news", at: `${dates[10]}T14:00:00Z`, links: [["NVDA", 0.9]] });
    await article({ title: "Other company", at: `${monday}T14:00:00Z`, links: [["MSFT", 0.9]] });
  });

  it("lists news landing on that trading day, merged by cluster, ranked by importance, with weak links excluded", async () => {
    const m = await getPortfolioMove(ctx.db, sid, portfolioId, { date: monday, now });
    expect(m.news.map((n) => n.title)).toEqual([
      "Acme cuts outlook",
      "Friday evening report on Apple",
    ]);
    expect(m.news[0]).toMatchObject({ tickers: ["NVDA"], copies: 1, linkScore: 0.9 });
    expect(m.news[0]!.classification).toMatchObject({
      class: "fundamental",
      eventType: "guidance_cut",
      fundamentalImportance: 8,
    });
    expect(m.news[1]!.classification).toBeNull();
  });

  it("returns no news for a day without any", async () => {
    const m = await getPortfolioMove(ctx.db, sid, portfolioId, { date: dates[30]!, now });
    expect(m.news).toEqual([]);
  });

  it("builds numbered facts that include the news and a caution, and that pass the grounding check", async () => {
    const m = await getPortfolioMove(ctx.db, sid, portfolioId, { date: monday, now });
    const facts = buildMoveFacts(m);
    const by = (label: string) => facts.filter((f) => f.label === label).map((f) => f.text);
    expect(by("Portfolio return that day")).toEqual([`${pp(m.portfolioReturn)}%`]);
    expect(by("Holding contribution")).toHaveLength(3);
    expect(by("Linked news")[0]).toBe("Acme cuts outlook (fundamental, NVDA)");
    expect(by("Caution")[0]).toMatch(/may coincide with, not cause/);
    expect(checkGrounding(`The portfolio returned ${pp(m.portfolioReturn)}% [F2].`, facts)).toEqual(
      [],
    );
    expect(moveTask(m)).toContain(monday);
    expect(moveTask(m)).toMatch(/never claim it caused the move/);
  });
});

describe("getMoveExplanation", () => {
  class Fake implements ExplainGenerator {
    readonly model = "fake";
    calls = 0;
    tasks: (string | undefined)[] = [];
    async generate(_f: unknown, _i: unknown, task?: string): Promise<RawExplanation> {
      this.calls++;
      this.tasks.push(task);
      return { summary: "The day was driven by technology holdings [F4].", highlights: [] };
    }
  }

  it("returns a grounded explanation with the move, caches it, and sends the move-specific task", async () => {
    const g = new Fake();
    const limiter = new RateLimiter(ctx.db, 5, 60_000);
    const date = dates[BAD]!;
    const first = await getMoveExplanation(ctx.db, sid, portfolioId, g, { date, now, limiter });
    expect(first).toMatchObject({
      cached: false,
      explanation: { source: "model" },
      move: { date },
    });
    expect(g.tasks[0]).toContain(date);
    const again = await getMoveExplanation(ctx.db, sid, portfolioId, g, { date, now, limiter });
    expect(again.cached).toBe(true);
    expect(g.calls).toBe(1);
    // A different day is a different question and is not served from that cache.
    const other = await getMoveExplanation(ctx.db, sid, portfolioId, g, {
      date: dates[BAD - 1]!,
      now,
      limiter,
    });
    expect(other.cached).toBe(false);
  });

  it("shares the hourly allowance with the portfolio explanation", async () => {
    // A fresh session, because the allowance is per session and the previous test already spent some of ours.
    const [fresh] = await ctx.db.insert(sessions).values({}).returning();
    const p = await createPortfolio(ctx.db, fresh!.id, {
      name: "Shared",
      normalize: false,
      holdings: holdingsOf([
        ["NVDA", 60],
        ["AAPL", 40],
      ]),
    });
    const g = new Fake();
    const limiter = new RateLimiter(ctx.db, 1, 60_000);
    await getMoveExplanation(ctx.db, fresh!.id, p.id, g, { date: dates[50]!, now, limiter });
    await expect(
      getMoveExplanation(ctx.db, fresh!.id, p.id, g, { date: dates[51]!, now, limiter }),
    ).rejects.toMatchObject({ code: "rate_limited" });
    // The portfolio explanation draws on the same allowance.
    await expect(
      getExplanation(ctx.db, fresh!.id, p.id, g, { now, limiter }),
    ).rejects.toMatchObject({ code: "rate_limited" });
  });
});
