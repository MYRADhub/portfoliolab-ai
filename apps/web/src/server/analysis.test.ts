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
import { createPortfolio } from "./portfolios";
import { getPortfolioCorrelation } from "./correlation";
import { getPortfolioExposures } from "./exposures";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let sid: string;
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

async function insertPrices(ticker: string, dates: string[], returns: number[]) {
  const [c] = await ctx.db.select().from(companies).where(eq(companies.ticker, ticker));
  let p = 100;
  const rows = dates.map((date, i) => {
    if (i > 0) p *= 1 + returns[i - 1]!;
    return { companyId: c!.id, date, close: p, adjClose: p };
  });
  await ctx.db.insert(pricesDaily).values(rows);
}

beforeAll(async () => {
  ctx = await createTestDb();
  await seedDevCompanies(ctx.db);
  [{ id: sid }] = (await ctx.db.insert(sessions).values({}).returning()) as { id: string }[];

  const dates = weekdays("2024-02-01", 100);
  // Deterministic base returns; B is exactly 2x A (correlation 1), C is orthogonal-ish via a different pattern.
  const a = dates.slice(1).map((_, i) => 0.01 * Math.sin(i * 1.3) + 0.002);
  const b = a.map((r) => 2 * r);
  const c = dates.slice(1).map((_, i) => 0.01 * Math.cos(i * 0.37 + 1));
  await insertPrices("NVDA", dates, a);
  await insertPrices("AAPL", dates, b);
  await insertPrices("MSFT", dates, c);
});
afterAll(async () => {
  await ctx.teardown();
});

describe("getPortfolioCorrelation", () => {
  it("returns a consistent matrix, ordering, and summary stats", async () => {
    const p = await createPortfolio(ctx.db, sid, {
      name: "Corr",
      normalize: false,
      holdings: holdingsOf([
        ["NVDA", 40],
        ["AAPL", 30],
        ["MSFT", 30],
      ]),
    });
    const r = await getPortfolioCorrelation(ctx.db, sid, p.id, { window: "1y", now });
    expect(r.tickers).toEqual(["AAPL", "MSFT", "NVDA"]);
    expect(r.matrix[0]![2]).toBeCloseTo(1, 10); // AAPL vs NVDA
    expect(r.matrix[0]![1]).toBeCloseTo(r.matrix[1]![0]!, 12);
    expect([...r.order].sort()).toEqual([0, 1, 2]);
    expect(Math.abs(r.order.indexOf(0) - r.order.indexOf(2))).toBe(1);
    expect(r.pairs[0]).toMatchObject({ a: "AAPL", b: "NVDA" });
    expect(r.diversificationRatio).toBeGreaterThanOrEqual(1);
    expect(r.window.tradingDays).toBe(100);
    expect(r.withPortfolio).toHaveLength(3);
    expect(r.stress).toBeNull(); // 10 worst days of 99 is below the 20-day minimum
  });

  it("rejects single-holding portfolios", async () => {
    const p = await createPortfolio(ctx.db, sid, {
      name: "One",
      normalize: false,
      holdings: holdingsOf([["NVDA", 100]]),
    });
    await expect(getPortfolioCorrelation(ctx.db, sid, p.id, { now })).rejects.toThrow(/at least 2/);
  });

  it("includes stress-period correlation with enough history", async () => {
    // Longer series: 400 days gives 40 worst days.
    const dates = weekdays("2022-06-01", 500);
    const x = dates.slice(1).map((_, i) => 0.01 * Math.sin(i * 0.9));
    const y = dates.slice(1).map((_, i) => 0.01 * Math.sin(i * 0.9 + 0.5));
    await ctx.db.delete(pricesDaily);
    await insertPrices("NVDA", dates, x);
    await insertPrices("AAPL", dates, y);
    const p = await createPortfolio(ctx.db, sid, {
      name: "Long",
      normalize: false,
      holdings: holdingsOf([
        ["NVDA", 50],
        ["AAPL", 50],
      ]),
    });
    const r = await getPortfolioCorrelation(ctx.db, sid, p.id, {
      window: "3y",
      now: new Date("2024-06-14T00:00:00Z"),
    });
    expect(r.stress).toMatchObject({ fraction: 0.1 });
    expect(r.stress!.days).toBeGreaterThanOrEqual(20);
  });
});

describe("getPortfolioExposures", () => {
  it("reports when no factors exist, then when coverage is partial", async () => {
    const p = await createPortfolio(ctx.db, sid, {
      name: "Exp",
      normalize: false,
      holdings: holdingsOf([
        ["NVDA", 50],
        ["AAPL", 30],
        ["JPM", 20],
      ]),
    });
    expect(await getPortfolioExposures(ctx.db, sid, p.id)).toMatchObject({
      available: false,
      reason: "no_factors",
    });

    const [ai, rates] = await ctx.db
      .insert(factors)
      .values([
        { slug: "ai", name: "AI capex", category: "theme", description: "d" },
        { slug: "rates", name: "Interest rates", category: "macro", description: "d" },
      ])
      .returning();
    const id = async (t: string) =>
      (await ctx.db.select().from(companies).where(eq(companies.ticker, t)))[0]!.id;
    const base = { confidence: 0.9, source: "manual" as const };
    await ctx.db.insert(companyFactorExposures).values([
      { companyId: await id("NVDA"), factorId: ai!.id, magnitude: 3, direction: 1, ...base },
      { companyId: await id("NVDA"), factorId: rates!.id, magnitude: 1, direction: -1, ...base },
      { companyId: await id("AAPL"), factorId: rates!.id, magnitude: 1, direction: -1, ...base },
    ]);
    const partial = await getPortfolioExposures(ctx.db, sid, p.id);
    expect(partial).toEqual({
      available: false,
      reason: "missing_exposures",
      missingTickers: ["JPM"],
    });

    await ctx.db.insert(companyFactorExposures).values({
      companyId: await id("JPM"),
      factorId: rates!.id,
      magnitude: 2,
      direction: 1,
      ...base,
    });
    const full = await getPortfolioExposures(ctx.db, sid, p.id);
    if (!full.available) throw new Error("expected available");
    const bySlug = Object.fromEntries(full.factors.map((f) => [f.slug, f]));
    expect(bySlug.ai!.net).toBeCloseTo(1.5, 12);
    expect(bySlug.rates!.net).toBeCloseTo(-0.5 - 0.3 + 0.4, 12);
    expect(full.concentration.factorHhi).toBeCloseTo((1.5 / 1.9) ** 2 + (0.4 / 1.9) ** 2, 12);
    expect(full.concentration.sectorHhi).toBeCloseTo(0.8 ** 2 + 0.2 ** 2, 12);
    expect(full.holdings.map((h) => [h.ticker, h.weight])).toEqual([
      ["NVDA", 0.5],
      ["AAPL", 0.3],
      ["JPM", 0.2],
    ]);
    expect(full.pairs[0]).toMatchObject({ a: "NVDA", b: "AAPL", shared: ["rates"] });
    expect(full.cells.find((c) => c.ticker === "JPM")).toMatchObject({
      factor: "rates",
      signed: 2,
    });
  });

  it("hides another session's portfolio", async () => {
    const [other] = await ctx.db.insert(sessions).values({}).returning();
    const p = await createPortfolio(ctx.db, sid, {
      name: "Priv",
      normalize: false,
      holdings: holdingsOf([["NVDA", 100]]),
    });
    await expect(getPortfolioExposures(ctx.db, other!.id, p.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
