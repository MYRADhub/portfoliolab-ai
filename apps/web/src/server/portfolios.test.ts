import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessions } from "@portfolio-lab/db";
import { createTestDb } from "@portfolio-lab/db/testing";
import { FixtureProvider, ingestPrices } from "@portfolio-lab/data";
import { seedDevCompanies } from "../../../../packages/db/src/seed/companies";
import {
  createPortfolio,
  getPortfolioAnalytics,
  listPortfolios,
  searchCompanies,
} from "./portfolios";
import { AppError } from "./errors";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let sid: string;
let other: string;
const now = new Date("2024-06-28T00:00:00Z");

beforeAll(async () => {
  ctx = await createTestDb();
  await seedDevCompanies(ctx.db);
  const provider = new FixtureProvider();
  for (const t of ["NVDA", "AAPL", "MSFT", "AMZN"]) {
    await ingestPrices(ctx.db, provider, t, { backfillFrom: "2023-06-01", to: "2024-06-28" });
  }
  // JPM has only 10 days of history.
  await ingestPrices(ctx.db, provider, "JPM", { backfillFrom: "2024-06-14", to: "2024-06-28" });
  [{ id: sid }, { id: other }] = (await ctx.db.insert(sessions).values([{}, {}]).returning()) as {
    id: string;
  }[];
});
afterAll(async () => {
  await ctx.teardown();
});

const holdingsOf = (pairs: [string, number][]) =>
  pairs.map(([ticker, weightPct]) => ({ ticker, weightPct }));

describe("createPortfolio", () => {
  it("creates the example portfolio", async () => {
    const p = await createPortfolio(ctx.db, sid, {
      name: "Example",
      normalize: false,
      holdings: holdingsOf([
        ["NVDA", 25],
        ["AAPL", 20],
        ["MSFT", 20],
        ["AMZN", 15],
        ["JPM", 20],
      ]),
    });
    expect(p.name).toBe("Example");
    expect(await listPortfolios(ctx.db, sid)).toHaveLength(1);
    expect(await listPortfolios(ctx.db, other)).toHaveLength(0);
  });

  it.each([
    [
      "weights not summing to 100",
      [
        ["NVDA", 50],
        ["AAPL", 20],
      ],
      /sum to 70/,
    ],
    [
      "duplicates",
      [
        ["NVDA", 50],
        ["NVDA", 50],
      ],
      /more than once/,
    ],
    [
      "zero weight",
      [
        ["NVDA", 100],
        ["AAPL", 0],
      ],
      /above 0/,
    ],
    [
      "unknown tickers",
      [
        ["NVDA", 50],
        ["ZZZZ", 50],
      ],
      /Unknown tickers: ZZZZ/,
    ],
  ] as const)("rejects %s", async (_n, pairs, msg) => {
    await expect(
      createPortfolio(ctx.db, sid, {
        name: "x",
        normalize: false,
        holdings: holdingsOf(pairs as unknown as [string, number][]),
      }),
    ).rejects.toThrow(msg);
  });

  it("normalizes when asked", async () => {
    const p = await createPortfolio(ctx.db, sid, {
      name: "Norm",
      normalize: true,
      holdings: holdingsOf([
        ["NVDA", 1],
        ["AAPL", 3],
      ]),
    });
    const a = await getPortfolioAnalytics(ctx.db, sid, p.id, { now });
    expect(a.holdings.map((h) => h.weight)).toEqual([0.75, 0.25]);
  });
});

describe("getPortfolioAnalytics", () => {
  it("computes stats over the shared window", async () => {
    const p = await createPortfolio(ctx.db, sid, {
      name: "Four",
      normalize: false,
      holdings: holdingsOf([
        ["NVDA", 40],
        ["AAPL", 30],
        ["MSFT", 20],
        ["AMZN", 10],
      ]),
    });
    const a = await getPortfolioAnalytics(ctx.db, sid, p.id, { now });
    expect(a.window.tradingDays).toBeGreaterThan(240);
    expect(a.window.limitedBy).toBeNull();
    expect(a.equityCurve).toHaveLength(a.window.tradingDays);
    expect(a.equityCurve[0]!.value).toBe(1);
    expect(a.stats.maxDrawdown).toBeLessThanOrEqual(0);
    expect(a.stats.annualizedVolatility).toBeGreaterThan(0);
    expect(a.concentration.topWeight).toBe(0.4);
    expect(a.sectors.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1, 9);
    expect(Math.min(...a.drawdown.map((d) => d.value))).toBeCloseTo(a.stats.maxDrawdown, 12);
  });

  it("reports when stored history is shorter than the requested window", async () => {
    const p = await createPortfolio(ctx.db, sid, {
      name: "TwoYears",
      normalize: false,
      holdings: holdingsOf([
        ["NVDA", 50],
        ["AAPL", 50],
      ]),
    });
    // Prices start 2023-06-01, so a 2-year window ending 2024-06-28 is limited by stored history.
    const a = await getPortfolioAnalytics(ctx.db, sid, p.id, { now, years: 2 });
    expect(a.window.from).toBe("2023-06-01");
    expect(["NVDA", "AAPL"]).toContain(a.window.limitedBy);
  });

  it("refuses when shared history is too short", async () => {
    const p = await createPortfolio(ctx.db, sid, {
      name: "Short",
      normalize: false,
      holdings: holdingsOf([
        ["NVDA", 50],
        ["JPM", 50],
      ]),
    });
    await expect(getPortfolioAnalytics(ctx.db, sid, p.id, { now })).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("hides another session's portfolio", async () => {
    const [mine] = await listPortfolios(ctx.db, sid);
    await expect(getPortfolioAnalytics(ctx.db, other, mine!.id, { now })).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(getPortfolioAnalytics(ctx.db, other, mine!.id, { now })).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("searchCompanies", () => {
  it("matches ticker prefix first, then name", async () => {
    const r = await searchCompanies(ctx.db, "a");
    expect(r[0]!.ticker).toBe("AAPL");
    expect((await searchCompanies(ctx.db, "micro"))[0]!.ticker).toBe("MSFT");
    expect(await searchCompanies(ctx.db, "")).toEqual([]);
  });
});
