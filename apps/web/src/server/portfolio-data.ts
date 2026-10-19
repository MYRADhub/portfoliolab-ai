import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { companies, holdings, portfolios, pricesDaily, type Db } from "@portfolio-lab/db";
import { commonDates } from "@portfolio-lab/finance";
import { AppError } from "./errors";

export const MIN_HISTORY_DAYS = 30;

export interface LoadedHolding {
  companyId: number;
  ticker: string;
  name: string;
  sector: string | null;
  weight: number;
}

export interface LoadedPortfolio {
  portfolio: { id: string; name: string };
  holdings: LoadedHolding[];
  series: { date: string; adjClose: number }[][];
  dates: string[];
  since: string;
  limitedBy: string | null;
}

export function addDays(date: string, n: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export function monthsAgo(date: Date, months: number): string {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Loads a session-owned portfolio with holdings, prices since `since`, and the shared trading-date window. */
export async function loadPortfolioWithPrices(
  db: Db,
  sessionId: string,
  portfolioId: string,
  since: string,
): Promise<LoadedPortfolio> {
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

  const limiting = hs.reduce((a, _, i) => (series[i]![0]!.date > series[a]![0]!.date ? i : a), 0);
  // Tolerate the weekend/holiday gap between the cutoff and the first trading day.
  const limitedBy = series[limiting]![0]!.date > addDays(since, 7) ? hs[limiting]!.ticker : null;

  return { portfolio: { id: p.id, name: p.name }, holdings: hs, series, dates, since, limitedBy };
}
