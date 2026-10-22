import {
  annualizedReturn,
  annualizedVolatility,
  dailyReturns,
  fanBands,
  portfolioReturns,
  quantile,
  shareBelow,
  simulateGrowth,
} from "@portfolio-lab/finance";
import type { Db } from "@portfolio-lab/db";
import { loadPortfolioWithPrices, monthsAgo } from "./portfolio-data";

export const HISTORY_YEARS = 3;
export const TRADING_DAYS_PER_YEAR = 252;
export const HORIZONS_YEARS = [1, 3, 5] as const;
export const DEFAULT_PATHS = 2000;
/** The yearly return the simulation is centred on by default: a long-run, equity-like figure, not the past few years' boom. */
export const DEFAULT_ASSUMED_RETURN = 0.07;

export interface Simulation {
  portfolio: { id: string; name: string };
  horizonYears: number;
  paths: number;
  /** The yearly return the paths are centred on, or null when the portfolio's own past average is used. */
  assumedAnnualReturn: number | null;
  history: {
    from: string;
    to: string;
    tradingDays: number;
    annualReturn: number;
    volatility: number;
  };
  /** Percentile bands of the portfolio value, starting from 100, at each checkpoint (trading day). */
  fan: { day: number; p5: number; p25: number; p50: number; p75: number; p95: number }[];
  summary: {
    medianEnd: number;
    p5End: number;
    p95End: number;
    /** Share of simulated paths that end below where they started. */
    probLoss: number;
    /** Share of paths that end at least 20% below the start. */
    probLoss20: number;
    /** Median of each path's worst fall from a peak, as a negative fraction. */
    medianMaxDrawdown: number;
    /** The worst-fall level that 1 path in 20 is worse than. */
    p5MaxDrawdown: number;
  };
  caveat: string;
}

/** Possible futures built by resampling the portfolio's own recent daily returns in blocks. A projection of the past, not a forecast. */
export async function getSimulation(
  db: Db,
  sessionId: string,
  portfolioId: string,
  opts: { years?: number; paths?: number; drift?: number | "historical"; now?: Date } = {},
): Promise<Simulation> {
  const {
    years = 3,
    paths = DEFAULT_PATHS,
    drift = DEFAULT_ASSUMED_RETURN,
    now = new Date(),
  } = opts;
  const loaded = await loadPortfolioWithPrices(
    db,
    sessionId,
    portfolioId,
    monthsAgo(now, HISTORY_YEARS * 12),
  );
  const byAsset = loaded.series.map((s) => dailyReturns(s, loaded.dates));
  const rets = portfolioReturns(
    loaded.holdings.map((h) => h.weight),
    byAsset,
  );
  const sim = simulateGrowth(rets, {
    horizonDays: years * TRADING_DAYS_PER_YEAR,
    paths,
    seed: 1,
    annualDrift: drift === "historical" ? undefined : drift,
  });
  const bands = fanBands(sim, [0.05, 0.25, 0.5, 0.75, 0.95]);
  return {
    portfolio: loaded.portfolio,
    horizonYears: years,
    paths,
    assumedAnnualReturn: drift === "historical" ? null : drift,
    history: {
      from: loaded.dates[0]!,
      to: loaded.dates.at(-1)!,
      tradingDays: rets.length,
      annualReturn: annualizedReturn(rets),
      volatility: annualizedVolatility(rets),
    },
    fan: sim.checkpoints.map((day, i) => ({
      day,
      p5: bands[i]![0]! * 100,
      p25: bands[i]![1]! * 100,
      p50: bands[i]![2]! * 100,
      p75: bands[i]![3]! * 100,
      p95: bands[i]![4]! * 100,
    })),
    summary: {
      medianEnd: quantile(sim.terminal, 0.5) * 100,
      p5End: quantile(sim.terminal, 0.05) * 100,
      p95End: quantile(sim.terminal, 0.95) * 100,
      probLoss: shareBelow(sim.terminal, 1),
      probLoss20: shareBelow(sim.terminal, 0.8),
      medianMaxDrawdown: quantile(sim.maxDrawdowns, 0.5),
      p5MaxDrawdown: quantile(sim.maxDrawdowns, 0.05),
    },
    caveat:
      "Paths are rebuilt from the last three years of this portfolio's daily returns, so they assume the future is as bumpy as that period. By default they are centred on a typical long-run yearly return rather than the past few years' average, because a boom would otherwise be assumed to repeat. Research information, not a forecast or advice.",
  };
}
