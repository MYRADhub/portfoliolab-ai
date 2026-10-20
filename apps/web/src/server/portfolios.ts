import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { companies, holdings, portfolios, type Db } from "@portfolio-lab/db";
import {
  annualizedReturn,
  annualizedVolatility,
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
import { loadPortfolioWithPrices, monthsAgo } from "./portfolio-data";

export { MIN_HISTORY_DAYS } from "./portfolio-data";

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

/** Deletes a session-owned portfolio and its holdings. Another session's portfolio is reported as not found. */
export async function deletePortfolio(
  db: Db,
  sessionId: string,
  portfolioId: string,
): Promise<void> {
  const deleted = await db
    .delete(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.sessionId, sessionId)))
    .returning({ id: portfolios.id });
  if (deleted.length === 0) throw new AppError("not_found", "Portfolio not found");
}

export async function listPortfolios(db: Db, sessionId: string) {
  return db
    .select({ id: portfolios.id, name: portfolios.name, createdAt: portfolios.createdAt })
    .from(portfolios)
    .where(eq(portfolios.sessionId, sessionId))
    .orderBy(desc(portfolios.createdAt));
}

export async function searchCompanies(db: Db, q: string, limit = 10) {
  const term = q.trim();
  if (!term) return [];
  const escaped = term.replace(/[\\%_]/g, "\\$&");
  return db
    .select({ ticker: companies.ticker, name: companies.name, sector: companies.sector })
    .from(companies)
    .where(or(ilike(companies.ticker, `${escaped}%`), ilike(companies.name, `%${escaped}%`)))
    .orderBy(sql`(${companies.ticker} ilike ${`${escaped}%`}) desc`, asc(companies.ticker))
    .limit(limit);
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
  const loaded = await loadPortfolioWithPrices(
    db,
    sessionId,
    portfolioId,
    monthsAgo(now, years * 12),
  );
  const { portfolio: p, holdings: hs, series, dates, limitedBy } = loaded;

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
