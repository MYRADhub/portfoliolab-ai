import type { Db } from "@portfolio-lab/db";
import {
  averagePairwise,
  clusterOrder,
  correlationMatrix,
  correlationWith,
  dailyReturns,
  diversificationRatio,
  portfolioReturns,
  worstDaysIndices,
} from "@portfolio-lab/finance";
import { AppError } from "./errors";
import { loadPortfolioWithPrices, monthsAgo } from "./portfolio-data";

export const CORRELATION_WINDOWS = { "6m": 6, "1y": 12, "3y": 36 } as const;
export type CorrelationWindow = keyof typeof CORRELATION_WINDOWS;

/** Fraction of worst portfolio days used for the stress-period view, and the minimum days needed to show it. */
export const STRESS_FRACTION = 0.1;
export const MIN_STRESS_DAYS = 20;

export interface PortfolioCorrelation {
  portfolio: { id: string; name: string };
  window: {
    label: CorrelationWindow;
    from: string;
    to: string;
    tradingDays: number;
    limitedBy: string | null;
  };
  tickers: string[];
  matrix: number[][];
  /** Heatmap display order (indices into tickers), clustered so similar assets are adjacent. */
  order: number[];
  averagePairwise: number;
  withPortfolio: { ticker: string; correlation: number }[];
  diversificationRatio: number;
  pairs: { a: string; b: string; correlation: number }[];
  stress: { fraction: number; days: number; averagePairwise: number } | null;
}

export async function getPortfolioCorrelation(
  db: Db,
  sessionId: string,
  portfolioId: string,
  opts: { window?: CorrelationWindow; now?: Date } = {},
): Promise<PortfolioCorrelation> {
  const { window = "1y", now = new Date() } = opts;
  const loaded = await loadPortfolioWithPrices(
    db,
    sessionId,
    portfolioId,
    monthsAgo(now, CORRELATION_WINDOWS[window]),
  );
  const { holdings: hs, series, dates } = loaded;
  if (hs.length < 2) throw new AppError("bad_request", "Correlation needs at least 2 holdings");

  const returns = series.map((s) => dailyReturns(s, dates));
  const weights = hs.map((h) => h.weight);
  let matrix: number[][];
  try {
    matrix = correlationMatrix(returns);
  } catch (e) {
    throw new AppError("conflict", e instanceof Error ? e.message : "Cannot compute correlations");
  }
  const tickers = hs.map((h) => h.ticker);
  const port = portfolioReturns(weights, returns);

  const pairs: PortfolioCorrelation["pairs"] = [];
  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++)
      pairs.push({ a: tickers[i]!, b: tickers[j]!, correlation: matrix[i]![j]! });
  }
  pairs.sort((x, y) => y.correlation - x.correlation);

  let stress: PortfolioCorrelation["stress"] = null;
  const worst = worstDaysIndices(port, STRESS_FRACTION);
  if (worst.length >= MIN_STRESS_DAYS) {
    try {
      const sub = returns.map((r) => worst.map((k) => r[k]!));
      stress = {
        fraction: STRESS_FRACTION,
        days: worst.length,
        averagePairwise: averagePairwise(correlationMatrix(sub))!,
      };
    } catch {
      stress = null;
    }
  }

  return {
    portfolio: loaded.portfolio,
    window: {
      label: window,
      from: dates[0]!,
      to: dates.at(-1)!,
      tradingDays: dates.length,
      limitedBy: loaded.limitedBy,
    },
    tickers,
    matrix,
    order: clusterOrder(matrix),
    averagePairwise: averagePairwise(matrix)!,
    withPortfolio: correlationWith(port, returns).map((correlation, i) => ({
      ticker: tickers[i]!,
      correlation,
    })),
    diversificationRatio: diversificationRatio(weights, returns),
    pairs,
    stress,
  };
}
