import { and, asc, eq, gte } from "drizzle-orm";
import { benchmarkPrices, type Db } from "@portfolio-lab/db";
import {
  benchmarkRelative,
  cumulativeGrowth,
  dailyReturns,
  portfolioReturns,
  rollingBeta,
  type BenchmarkStats,
} from "@portfolio-lab/finance";
import { loadPortfolioWithPrices, monthsAgo } from "./portfolio-data";

export const BENCHMARK_SYMBOL = "SPY";
export const BENCHMARK_NAME = "S&P 500 (SPY)";
export const BENCHMARK_YEARS = 3;
export const ROLLING_WINDOW = 126;
const MIN_DAYS = 60;

export type BenchmarkResult =
  | { available: false; reason: "no_benchmark" | "short_history" }
  | {
      available: true;
      portfolio: { id: string; name: string };
      benchmark: { symbol: string; name: string };
      window: { from: string; to: string; tradingDays: number };
      stats: BenchmarkStats;
      /** Both series rebased to 100 at the start. */
      curves: { dates: string[]; portfolio: number[]; benchmark: number[] };
      rollingBeta: { date: string; value: number }[];
      /** Calendar-year returns; the first and last years may be partial. */
      years: { year: number; portfolio: number; benchmark: number; partial: boolean }[];
    };

/** Compares a portfolio with the S&P 500 over the last three years, using the dates both have prices for. */
export async function getBenchmark(
  db: Db,
  sessionId: string,
  portfolioId: string,
  opts: { now?: Date } = {},
): Promise<BenchmarkResult> {
  const { now = new Date() } = opts;
  const since = monthsAgo(now, BENCHMARK_YEARS * 12);
  const loaded = await loadPortfolioWithPrices(db, sessionId, portfolioId, since);
  const bench = await db
    .select({ date: benchmarkPrices.date, adjClose: benchmarkPrices.adjClose })
    .from(benchmarkPrices)
    .where(
      and(
        eq(benchmarkPrices.symbol, BENCHMARK_SYMBOL),
        gte(benchmarkPrices.date, loaded.dates[0] ?? since),
      ),
    )
    .orderBy(asc(benchmarkPrices.date));
  if (bench.length === 0) return { available: false, reason: "no_benchmark" };

  const have = new Set(bench.map((b) => b.date));
  const dates = loaded.dates.filter((d) => have.has(d));
  if (dates.length < MIN_DAYS) return { available: false, reason: "short_history" };

  const rets = portfolioReturns(
    loaded.holdings.map((h) => h.weight),
    loaded.series.map((s) => dailyReturns(s, dates)),
  );
  const brets = dailyReturns(bench, dates);
  const retDates = dates.slice(1);

  const years = new Map<number, { p: number; b: number; first: string; last: string }>();
  retDates.forEach((d, i) => {
    const y = Number(d.slice(0, 4));
    const cur = years.get(y) ?? { p: 1, b: 1, first: d, last: d };
    cur.p *= 1 + rets[i]!;
    cur.b *= 1 + brets[i]!;
    cur.last = d;
    years.set(y, cur);
  });
  const firstYear = Number(retDates[0]!.slice(0, 4));
  const lastYear = Number(retDates.at(-1)!.slice(0, 4));

  const pg = cumulativeGrowth(rets).map((g) => g * 100);
  const bg = cumulativeGrowth(brets).map((g) => g * 100);
  return {
    available: true,
    portfolio: loaded.portfolio,
    benchmark: { symbol: BENCHMARK_SYMBOL, name: BENCHMARK_NAME },
    window: { from: dates[0]!, to: dates.at(-1)!, tradingDays: rets.length },
    stats: benchmarkRelative(rets, brets),
    curves: { dates, portfolio: pg, benchmark: bg },
    rollingBeta: rollingBeta(rets, brets, ROLLING_WINDOW).map((r) => ({
      date: retDates[r.index]!,
      value: r.beta,
    })),
    years: [...years.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, v]) => ({
        year,
        portfolio: v.p - 1,
        benchmark: v.b - 1,
        partial: year === firstYear || year === lastYear,
      })),
  };
}
