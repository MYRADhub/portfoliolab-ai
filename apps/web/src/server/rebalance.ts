import {
  annualizedReturn,
  annualizedVolatility,
  covarianceMatrix,
  cumulativeGrowth,
  dailyReturns,
  equalWeights,
  maxDrawdown,
  minVarianceWeights,
  portfolioReturns,
  riskParityWeights,
  riskShares,
  sharpeRatio,
} from "@portfolio-lab/finance";
import type { Db } from "@portfolio-lab/db";
import { AppError } from "./errors";
import { loadPortfolioWithPrices, monthsAgo } from "./portfolio-data";

export const REBALANCE_YEARS = 3;
export const DEFAULT_MAX_WEIGHT = 0.4;

export interface Strategy {
  id: "current" | "equal" | "min_variance" | "risk_parity";
  name: string;
  description: string;
  weights: { ticker: string; weight: number; riskShare: number }[];
  volatility: number;
  annualReturn: number;
  sharpe: number;
  maxDrawdown: number;
  /** Effective number of positions, 1 / sum of squared weights. */
  effectiveN: number;
  /** Half the sum of absolute weight changes from the current portfolio: the share of money that would move. */
  turnover: number;
}

export interface Rebalance {
  portfolio: { id: string; name: string };
  window: { from: string; to: string; tradingDays: number };
  maxWeight: number;
  strategies: Strategy[];
  curves: { dates: string[]; series: Record<string, number[]> };
  caveat: string;
}

/**
 * Compares the current weights with three alternatives built only from the holdings' own price history: equal weights,
 * the long-only minimum-variance mix and risk parity. All numbers are in-sample, so they describe the past, not the future.
 */
export async function getRebalance(
  db: Db,
  sessionId: string,
  portfolioId: string,
  opts: { maxWeight?: number; now?: Date } = {},
): Promise<Rebalance> {
  const { now = new Date() } = opts;
  const loaded = await loadPortfolioWithPrices(
    db,
    sessionId,
    portfolioId,
    monthsAgo(now, REBALANCE_YEARS * 12),
  );
  const hs = loaded.holdings;
  if (hs.length < 2) throw new AppError("bad_request", "Rebalancing needs at least two holdings");
  const cap = Math.min(1, Math.max(opts.maxWeight ?? DEFAULT_MAX_WEIGHT, 1 / hs.length));
  const byAsset = loaded.series.map((s) => dailyReturns(s, loaded.dates));
  const cov = covarianceMatrix(byAsset);
  const current = hs.map((h) => h.weight);

  const defs: { id: Strategy["id"]; name: string; description: string; w: number[] }[] = [
    {
      id: "current",
      name: "Your weights",
      description: "The portfolio as you built it.",
      w: current,
    },
    {
      id: "equal",
      name: "Equal weights",
      description: "The same amount in every holding.",
      w: equalWeights(hs.length),
    },
    {
      id: "min_variance",
      name: "Lowest volatility",
      description: `The long-only mix with the smallest historical volatility, with no holding above ${Math.round(cap * 100)}%.`,
      w: minVarianceWeights(cov, { maxWeight: cap }),
    },
    {
      id: "risk_parity",
      name: "Equal risk",
      description: "Each holding contributes the same share of the portfolio's ups and downs.",
      w: riskParityWeights(cov),
    },
  ];

  const series: Record<string, number[]> = {};
  const strategies: Strategy[] = defs.map((d) => {
    const rets = portfolioReturns(d.w, byAsset);
    series[d.id] = cumulativeGrowth(rets).map((g) => g * 100);
    const shares = riskShares(d.w, cov);
    return {
      id: d.id,
      name: d.name,
      description: d.description,
      weights: hs.map((h, i) => ({ ticker: h.ticker, weight: d.w[i]!, riskShare: shares[i]! })),
      volatility: annualizedVolatility(rets),
      annualReturn: annualizedReturn(rets),
      sharpe: sharpeRatio(rets, 0),
      maxDrawdown: maxDrawdown(rets),
      effectiveN: 1 / d.w.reduce((a, w) => a + w * w, 0),
      turnover: 0.5 * d.w.reduce((a, w, i) => a + Math.abs(w - current[i]!), 0),
    };
  });

  return {
    portfolio: loaded.portfolio,
    window: {
      from: loaded.dates[0]!,
      to: loaded.dates.at(-1)!,
      tradingDays: loaded.dates.length - 1,
    },
    maxWeight: cap,
    strategies,
    curves: { dates: loaded.dates, series },
    caveat:
      "These figures use only past prices and were fitted on the same period they are measured on, so the alternatives look better than they could have been known to be in advance. Research information, not advice.",
  };
}
