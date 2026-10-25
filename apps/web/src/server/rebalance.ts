import {
  annualizedReturn,
  annualizedVolatility,
  covarianceMatrix,
  cumulativeGrowth,
  dailyReturns,
  equalWeights,
  exposureGram,
  factorConcentration,
  factorLoadings,
  maxDrawdown,
  minVarianceWeights,
  portfolioReturns,
  riskParityWeights,
  riskShares,
  sharpeRatio,
} from "@portfolio-lab/finance";
import type { Db } from "@portfolio-lab/db";
import { AppError } from "./errors";
import { getPortfolioExposures } from "./exposures";
import { loadPortfolioWithPrices, monthsAgo } from "./portfolio-data";

export const REBALANCE_YEARS = 3;
export const DEFAULT_MAX_WEIGHT = 0.4;

export interface Strategy {
  id: "current" | "equal" | "min_variance" | "risk_parity" | "min_exposure";
  name: string;
  description: string;
  weights: { ticker: string; weight: number; riskShare: number }[];
  volatility: number;
  annualReturn: number;
  sharpe: number;
  maxDrawdown: number;
  /** Effective number of positions, 1 / sum of squared weights. */
  effectiveN: number;
  /** Effective number of independent economic forces the mix depends on; null without exposure data. */
  effectiveFactors: number | null;
  /** Sum of absolute net loadings across forces: total hidden dependence, whatever its spread. Null without exposure data. */
  grossLoading: number | null;
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

  // Hidden-exposure view: only when every holding has an exposure profile.
  const exp = await getPortfolioExposures(db, sessionId, portfolioId);
  const slugs = exp.available ? exp.factors.map((f) => f.slug) : [];
  const signed = new Map<string, Record<string, number>>();
  if (exp.available)
    for (const c of exp.cells)
      signed.set(c.ticker, { ...signed.get(c.ticker), [c.factor]: c.signed });
  const matrix = hs.map((h) => slugs.map((s) => signed.get(h.ticker)?.[s] ?? 0));
  const exposureOf = (w: number[]) => {
    if (!exp.available) return { effectiveFactors: null, grossLoading: null };
    const loadings = factorLoadings(
      hs.map((h, i) => ({
        ticker: h.ticker,
        weight: w[i]!,
        exposures: signed.get(h.ticker) ?? {},
      })),
    );
    return {
      effectiveFactors: factorConcentration(loadings).effectiveFactors,
      grossLoading: loadings.reduce((a, l) => a + Math.abs(l.net), 0),
    };
  };

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
    ...(exp.available
      ? [
          {
            id: "min_exposure" as const,
            name: "Smallest net exposure",
            description: `The mix whose net dependence on every economic force is smallest, with no holding above ${Math.round(cap * 100)}%. It uses the exposure scores, not prices, and works by cancelling opposite exposures, so it can raise volatility and lower the number of effective forces.`,
            w: minVarianceWeights(exposureGram(matrix), { maxWeight: cap }),
          },
        ]
      : []),
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
      ...exposureOf(d.w),
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
