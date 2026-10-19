import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { companies, holdings, portfolios, pricesDaily, type Db } from "@portfolio-lab/db";
import {
  annualizedReturn,
  annualizedVolatility,
  commonDates,
  concentration,
  cumulativeGrowth,
  dailyReturns,
  drawdownSeries,
  maxDrawdown,
  normalizeWeights,
  portfolioReturns,
  sectorAllocation,
  sharpeRatio,
  totalReturn,
  validateWeights,
  type WeightIssue,
} from "@portfolio-lab/finance";
import { z } from "zod";
import { AppError } from "./errors";

export const MIN_HISTORY_DAYS = 30;

export const createPortfolioSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** When true, weights are rescaled to sum to 100 instead of rejected. */
  normalize: z.boolean().default(false),
  holdings: z
    .array(
      z.object({
        ticker: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z.\-]{1,10}$/),
        weightPct: z.number().finite(),
      }),
    )
    .min(1)
    .max(50),
});

export type CreatePortfolioInput = z.infer<typeof createPortfolioSchema>;

function describeIssue(i: WeightIssue): string {
  switch (i.kind) {
    case "empty":
      return "Add at least one holding";
    case "duplicate":
      return `${i.ticker} appears more than once`;
    case "non_positive":
      return `${i.ticker} must have a weight above 0`;
    case "sum":
      return `Weights sum to ${(i.sum * 100).toFixed(2)}%, expected 100%`;
  }
}

export async function createPortfolio(db: Db, sessionId: string, input: CreatePortfolioInput) {
  let items = input.holdings.map((h) => ({ ticker: h.ticker, weight: h.weightPct / 100 }));
  if (input.normalize) {
    const nonPositive = items.find((i) => !(i.weight > 0));
    if (nonPositive)
      throw new AppError("bad_request", `${nonPositive.ticker} must have a weight above 0`);
    items = normalizeWeights(items);
  }
  const issues = validateWeights(items);
  if (issues.length)
    throw new AppError("bad_request", issues.map(describeIssue).join("; "), issues);

  const found = await db
    .select({ id: companies.id, ticker: companies.ticker })
    .from(companies)
    .where(
      inArray(
        companies.ticker,
        items.map((i) => i.ticker),
      ),
    );
  const byTicker = new Map(found.map((c) => [c.ticker, c.id]));
  const unknown = items.filter((i) => !byTicker.has(i.ticker)).map((i) => i.ticker);
  if (unknown.length)
    throw new AppError("bad_request", `Unknown tickers: ${unknown.join(", ")}`, { unknown });

  return db.transaction(async (tx) => {
    const [p] = await tx.insert(portfolios).values({ sessionId, name: input.name }).returning();
    await tx.insert(holdings).values(
      items.map((i) => ({
        portfolioId: p!.id,
        companyId: byTicker.get(i.ticker)!,
        weight: i.weight,
      })),
    );
    return p!;
  });
}

export async function listPortfolios(db: Db, sessionId: string) {
  return db
    .select({ id: portfolios.id, name: portfolios.name, createdAt: portfolios.createdAt })
    .from(portfolios)
    .where(eq(portfolios.sessionId, sessionId))
    .orderBy(desc(portfolios.createdAt));
}

export async function searchCompanies(db: Db, q: string, limit = 10) {
  const term = q.trim().toUpperCase();
  if (!term) return [];
  const rows = await db
    .select({ ticker: companies.ticker, name: companies.name, sector: companies.sector })
    .from(companies)
    .orderBy(asc(companies.ticker));
  return rows
    .filter((r) => r.ticker.startsWith(term) || r.name.toUpperCase().includes(term))
    .sort((a, b) => Number(b.ticker.startsWith(term)) - Number(a.ticker.startsWith(term)))
    .slice(0, limit);
}

export interface PortfolioAnalytics {
  portfolio: { id: string; name: string };
  window: { from: string; to: string; tradingDays: number; limitedBy: string | null };
  holdings: { ticker: string; name: string; sector: string | null; weight: number }[];
  stats: {
    totalReturn: number;
    annualizedReturn: number;
    annualizedVolatility: number;
    maxDrawdown: number;
    sharpe: number;
    riskFreeAnnual: number;
  };
  concentration: { hhi: number; effectiveN: number; topWeight: number };
  sectors: { sector: string; weight: number }[];
  equityCurve: { date: string; value: number }[];
  drawdown: { date: string; value: number }[];
}

function addDays(date: string, n: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function yearsAgo(date: Date, years: number): string {
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

/**
 * Constant-weight (daily rebalanced) analytics over the longest window where every holding has prices,
 * capped at `years`. Risk-free rate is 0 until FRED is wired in; the value is returned so the UI can show it.
 */
export async function getPortfolioAnalytics(
  db: Db,
  sessionId: string,
  portfolioId: string,
  opts: { years?: number; now?: Date } = {},
): Promise<PortfolioAnalytics> {
  const { years = 1, now = new Date() } = opts;
  const [p] = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.sessionId, sessionId)));
  if (!p) throw new AppError("not_found", "Portfolio not found");

  const hs = await db
    .select({
      companyId: companies.id,
      ticker: companies.ticker,
      name: companies.name,
      sector: companies.sector,
      weight: holdings.weight,
    })
    .from(holdings)
    .innerJoin(companies, eq(companies.id, holdings.companyId))
    .where(eq(holdings.portfolioId, portfolioId))
    .orderBy(asc(companies.ticker));

  const since = yearsAgo(now, years);
  const prices = await db
    .select({
      companyId: pricesDaily.companyId,
      date: pricesDaily.date,
      adjClose: pricesDaily.adjClose,
    })
    .from(pricesDaily)
    .where(
      and(
        inArray(
          pricesDaily.companyId,
          hs.map((h) => h.companyId),
        ),
        gte(pricesDaily.date, since),
      ),
    )
    .orderBy(asc(pricesDaily.date));

  const series = hs.map((h) =>
    prices
      .filter((r) => r.companyId === h.companyId)
      .map((r) => ({ date: r.date, adjClose: r.adjClose })),
  );
  const missing = hs.filter((_, i) => series[i]!.length === 0).map((h) => h.ticker);
  if (missing.length) {
    throw new AppError("conflict", `No price history yet for: ${missing.join(", ")}`, { missing });
  }

  const dates = commonDates(series);
  if (dates.length < MIN_HISTORY_DAYS) {
    throw new AppError(
      "conflict",
      `Only ${dates.length} trading days of shared history; at least ${MIN_HISTORY_DAYS} are required`,
      { tradingDays: dates.length },
    );
  }

  const limiting = hs.reduce((a, h, i) => (series[i]![0]!.date > series[a]![0]!.date ? i : a), 0);
  // Tolerate the weekend/holiday gap between the cutoff and the first trading day.
  const limitedBy = series[limiting]![0]!.date > addDays(since, 7) ? hs[limiting]!.ticker : null;

  const returns = portfolioReturns(
    hs.map((h) => h.weight),
    series.map((s) => dailyReturns(s, dates)),
  );
  const growth = cumulativeGrowth(returns);
  const dd = drawdownSeries(returns);
  const weights = hs.map((h) => h.weight);
  const riskFreeAnnual = 0;

  return {
    portfolio: { id: p.id, name: p.name },
    window: { from: dates[0]!, to: dates.at(-1)!, tradingDays: dates.length, limitedBy },
    holdings: hs.map((h) => ({
      ticker: h.ticker,
      name: h.name,
      sector: h.sector,
      weight: h.weight,
    })),
    stats: {
      totalReturn: totalReturn(returns),
      annualizedReturn: annualizedReturn(returns),
      annualizedVolatility: annualizedVolatility(returns),
      maxDrawdown: maxDrawdown(returns),
      sharpe: sharpeRatio(returns, riskFreeAnnual),
      riskFreeAnnual,
    },
    concentration: { ...concentration(weights), topWeight: Math.max(...weights) },
    sectors: sectorAllocation(hs),
    equityCurve: dates.map((date, i) => ({ date, value: growth[i]! })),
    drawdown: dates.map((date, i) => ({ date, value: dd[i]! })),
  };
}
