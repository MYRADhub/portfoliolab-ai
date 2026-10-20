import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  companies,
  companyFactorExposures,
  factors,
  pricesDaily,
  sessions,
} from "@portfolio-lab/db";
import { createTestDb } from "@portfolio-lab/db/testing";
import { seedDevCompanies } from "../../../../packages/db/src/seed/companies";
import { createPortfolio, getPortfolioAnalytics } from "./portfolios";
import { getTerminal } from "./terminal";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let sid: string;
let pid: string;
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
const dates = weekdays("2023-11-01", 180);
const returnsFor = (t: string) =>
  dates
    .slice(1)
    .map(
      (_, i) =>
        0.012 * Math.sin(i * (t === "NVDA" ? 0.7 : t === "AAPL" ? 0.31 : 0.19) + t.length) + 0.0006,
    );

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

beforeAll(async () => {
  ctx = await createTestDb();
  await seedDevCompanies(ctx.db);
  [{ id: sid }] = (await ctx.db.insert(sessions).values({}).returning()) as { id: string }[];
  for (const t of ["NVDA", "AAPL", "JPM"]) await insertPrices(t);
  const p = await createPortfolio(ctx.db, sid, {
    name: "Terminal",
    normalize: false,
    holdings: [
      { ticker: "NVDA", weightPct: 50 },
      { ticker: "AAPL", weightPct: 30 },
      { ticker: "JPM", weightPct: 20 },
    ],
  });
  pid = p.id;
});
afterAll(async () => {
  await ctx.teardown();
});

describe("getTerminal", () => {
  it("agrees with the analytics numbers for the same portfolio", async () => {
    const t = await getTerminal(ctx.db, sid, pid, { now });
    const a = await getPortfolioAnalytics(ctx.db, sid, pid, { now, years: 2 });
    expect(t.window.tradingDays).toBe(a.window.tradingDays);
    expect(t.risk.volatility).toBeCloseTo(a.stats.annualizedVolatility, 12);
    expect(t.risk.maxDrawdown).toBeCloseTo(a.stats.maxDrawdown, 12);
    expect(t.risk.sharpe).toBeCloseTo(a.stats.sharpe, 12);
    expect(t.index.value).toBeCloseTo(100 * (1 + a.stats.totalReturn), 8);
    expect(t.performance.at(-1)!.value).toBeCloseTo(a.stats.totalReturn, 12);
    expect(t.equity[0]!.value).toBe(100);
    expect(t.equity).toHaveLength(t.window.tradingDays);
    expect(t.asOf).toBe(dates.at(-1));
  });

  it("computes period returns that compound correctly and leaves unavailable ones null", async () => {
    const t = await getTerminal(ctx.db, sid, pid, { now });
    const byLabel = Object.fromEntries(t.performance.map((p) => [p.label, p.value]));
    const last = t.equity.at(-1)!.value;
    expect(byLabel["1 day"]).toBeCloseTo(last / t.equity.at(-2)!.value - 1, 12);
    expect(byLabel["1 week"]).toBeCloseTo(last / t.equity.at(-6)!.value - 1, 12);
    expect(byLabel["1 month"]).toBeCloseTo(last / t.equity.at(-22)!.value - 1, 12);
    expect(byLabel["1 year"]).toBeNull(); // only 180 trading days of history
    // Year to date starts from the last close of 2023.
    const i = t.equity.findLastIndex((p) => p.date < "2024-01-01");
    expect(byLabel["Year to date"]).toBeCloseTo(last / t.equity[i]!.value - 1, 12);
  });

  it("gives holdings with sparklines, moves and risk shares that add to one", async () => {
    const t = await getTerminal(ctx.db, sid, pid, { now });
    expect(t.holdings.map((h) => h.ticker)).toEqual(["NVDA", "AAPL", "JPM"]); // by weight
    expect(t.holdings.reduce((a, h) => a + h.riskShare, 0)).toBeCloseTo(1, 10);
    for (const h of t.holdings) {
      expect(h.sparkline).toHaveLength(60);
      expect(h.sparkline[0]).toBeCloseTo(100, 10);
      expect(h.price).toBeGreaterThan(0);
      expect(h.d1).not.toBeNull();
      expect(h.m1).not.toBeNull();
    }
    expect(t.holdings[0]!.weight).toBe(0.5);
  });

  it("keeps the risk statistics ordered and within sensible bounds", async () => {
    const { risk } = await getTerminal(ctx.db, sid, pid, { now });
    expect(risk.var99).toBeLessThanOrEqual(risk.var95);
    expect(risk.expectedShortfall95).toBeLessThanOrEqual(risk.var95);
    expect(risk.worst.value).toBeLessThanOrEqual(risk.var99);
    expect(risk.best.value).toBeGreaterThan(0);
    expect(risk.upDayShare).toBeGreaterThan(0);
    expect(risk.upDayShare).toBeLessThan(1);
  });

  it("builds the distribution, rolling volatility, monthly and drawdown panels consistently", async () => {
    const t = await getTerminal(ctx.db, sid, pid, { now });
    expect(t.histogram).toHaveLength(21);
    expect(t.histogram.reduce((a, b) => a + b.count, 0)).toBe(t.window.tradingDays - 1);
    expect(t.rollingVolatility).toHaveLength(t.window.tradingDays - 1 - 21 + 1);
    expect(t.rollingVolatility[0]!.date).toBe(dates[21]);
    const monthlyGrowth = t.monthly.reduce((g, m) => g * (1 + m.return), 1);
    expect(monthlyGrowth).toBeCloseTo(t.equity.at(-1)!.value / 100, 10);
    expect(t.drawdowns.length).toBeGreaterThan(0);
    expect(t.drawdowns[0]!.depth).toBeCloseTo(t.risk.maxDrawdown, 12);
    expect(t.drawdowns.map((d) => d.depth)).toEqual(
      [...t.drawdowns.map((d) => d.depth)].sort((a, b) => a - b),
    );
  });

  it("reports correlation, empty news, and unavailable exposures when there is no such data", async () => {
    const t = await getTerminal(ctx.db, sid, pid, { now });
    expect(t.correlation!.topPairs).toHaveLength(3);
    expect(t.correlation!.topPairs[0]!.correlation).toBeGreaterThanOrEqual(
      t.correlation!.topPairs[2]!.correlation,
    );
    expect(t.news).toEqual([]);
    expect(t.exposures).toEqual({ available: false, reason: "no_factors" });
  });

  it("includes exposure highlights once every holding is covered, and skips correlation for one holding", async () => {
    const [f] = await ctx.db
      .insert(factors)
      .values({ slug: "rates", name: "Interest rates", category: "macro", description: "d" })
      .returning();
    for (const t of ["NVDA", "AAPL", "JPM"]) {
      const [c] = await ctx.db.select().from(companies).where(eq(companies.ticker, t));
      await ctx.db.insert(companyFactorExposures).values({
        companyId: c!.id,
        factorId: f!.id,
        magnitude: 2,
        direction: t === "JPM" ? 1 : -1,
        confidence: 0.8,
        source: "manual",
      });
    }
    const t = await getTerminal(ctx.db, sid, pid, { now });
    expect(t.exposures).toMatchObject({ available: true });
    if (t.exposures.available)
      expect(t.exposures.topFactors[0]).toMatchObject({ name: "Interest rates" });
    const solo = await createPortfolio(ctx.db, sid, {
      name: "Solo",
      normalize: false,
      holdings: [{ ticker: "NVDA", weightPct: 100 }],
    });
    expect((await getTerminal(ctx.db, sid, solo.id, { now })).correlation).toBeNull();
  });

  it("hides another session's portfolio", async () => {
    const [other] = await ctx.db.insert(sessions).values({}).returning();
    await expect(getTerminal(ctx.db, other!.id, pid, { now })).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
