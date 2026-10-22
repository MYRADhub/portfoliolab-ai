import { covarianceMatrix } from "./correlation";
import { TRADING_DAYS, stdev } from "./metrics";

/** Compounded return over the last `n` daily returns, or null when there is not enough history. */
export function periodReturn(returns: readonly number[], n: number): number | null {
  if (n < 1 || returns.length < n) return null;
  return returns.slice(-n).reduce((g, r) => g * (1 + r), 1) - 1;
}

/** Fraction of days with a positive return. */
export function upDayShare(returns: readonly number[]): number {
  if (returns.length === 0) throw new Error("empty series");
  return returns.filter((r) => r > 0).length / returns.length;
}

export interface DayExtreme {
  date: string;
  value: number;
}

/** Best and worst single days. `dates` are the dates the returns belong to (same length as returns). */
export function bestWorstDays(
  dates: readonly string[],
  returns: readonly number[],
): { best: DayExtreme; worst: DayExtreme } {
  if (returns.length === 0 || dates.length !== returns.length)
    throw new Error("dates and returns must match and be non-empty");
  let best = 0;
  let worst = 0;
  for (let i = 1; i < returns.length; i++) {
    if (returns[i]! > returns[best]!) best = i;
    if (returns[i]! < returns[worst]!) worst = i;
  }
  return {
    best: { date: dates[best]!, value: returns[best]! },
    worst: { date: dates[worst]!, value: returns[worst]! },
  };
}

/** The `n` best and `n` worst single days, each ordered from most extreme. `dates` belong to the returns. */
export function topDays(
  dates: readonly string[],
  returns: readonly number[],
  n = 5,
): { best: DayExtreme[]; worst: DayExtreme[] } {
  if (dates.length !== returns.length) throw new Error("dates and returns must match");
  const days = returns.map((value, i) => ({ date: dates[i]!, value }));
  const byValue = (a: DayExtreme, b: DayExtreme) =>
    a.value - b.value || a.date.localeCompare(b.date);
  const sorted = [...days].sort(byValue);
  return { worst: sorted.slice(0, n), best: sorted.slice(-n).reverse() };
}

/**
 * Historical value at risk: the daily return that was only beaten on the worst (1 - level) share of days,
 * returned as a negative return (for example -0.021 means a 2.1% one-day loss).
 */
export function historicalVar(returns: readonly number[], level = 0.95): number {
  if (returns.length === 0) throw new Error("empty series");
  if (!(level > 0 && level < 1)) throw new Error("level must be between 0 and 1");
  const sorted = [...returns].sort((a, b) => a - b);
  const k = Math.max(1, Math.floor((1 - level) * sorted.length));
  return sorted[k - 1]!;
}

/** Expected shortfall: the average return on the days at or below the value at risk. */
export function expectedShortfall(returns: readonly number[], level = 0.95): number {
  const threshold = historicalVar(returns, level);
  const tail = returns.filter((r) => r <= threshold);
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}

/** Annualized volatility over a sliding window; element i covers returns [i, i + window). */
export function rollingVolatility(returns: readonly number[], window: number): number[] {
  if (window < 2 || window > returns.length)
    throw new Error("window must be between 2 and the series length");
  const out: number[] = [];
  for (let i = 0; i + window <= returns.length; i++)
    out.push(stdev(returns.slice(i, i + window)) * Math.sqrt(TRADING_DAYS));
  return out;
}

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}

/** Equal-width histogram between the minimum and maximum; the maximum falls in the last bin. */
export function histogram(values: readonly number[], bins: number): HistogramBin[] {
  if (values.length === 0 || bins < 1) throw new Error("need values and at least one bin");
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = (max - min) / bins || 1;
  const out: HistogramBin[] = Array.from({ length: bins }, (_, i) => ({
    from: min + i * width,
    to: min + (i + 1) * width,
    count: 0,
  }));
  for (const v of values) out[Math.min(bins - 1, Math.floor((v - min) / width))]!.count++;
  return out;
}

export interface MonthReturn {
  month: string; // YYYY-MM
  return: number;
}

/** Compounded return per calendar month. `dates` belong to the returns (same length). */
export function monthlyReturns(
  dates: readonly string[],
  returns: readonly number[],
): MonthReturn[] {
  if (dates.length !== returns.length) throw new Error("dates and returns must match");
  const growth = new Map<string, number>();
  for (let i = 0; i < returns.length; i++) {
    const month = dates[i]!.slice(0, 7);
    growth.set(month, (growth.get(month) ?? 1) * (1 + returns[i]!));
  }
  return [...growth.entries()].map(([month, g]) => ({ month, return: g - 1 }));
}

export interface DrawdownEpisode {
  peak: string;
  trough: string;
  /** First date back at or above the peak, or null if it has not recovered. */
  recovery: string | null;
  /** Negative fraction at the trough. */
  depth: number;
  /** Trading days from peak to trough. */
  daysToTrough: number;
}

/**
 * The deepest peak-to-trough declines. `dates` has one more element than `returns` (it includes the starting
 * date), so index 0 is the start and returns[i] moves from dates[i] to dates[i + 1].
 */
export function drawdownEpisodes(
  dates: readonly string[],
  returns: readonly number[],
  top = 3,
): DrawdownEpisode[] {
  if (dates.length !== returns.length + 1) throw new Error("dates must include the starting date");
  const value = [1];
  for (const r of returns) value.push(value.at(-1)! * (1 + r));

  const episodes: DrawdownEpisode[] = [];
  let peakIdx = 0;
  let troughIdx = 0;
  const close = (recoveryIdx: number | null) => {
    if (troughIdx > peakIdx) {
      episodes.push({
        peak: dates[peakIdx]!,
        trough: dates[troughIdx]!,
        recovery: recoveryIdx === null ? null : dates[recoveryIdx]!,
        depth: value[troughIdx]! / value[peakIdx]! - 1,
        daysToTrough: troughIdx - peakIdx,
      });
    }
  };
  for (let i = 1; i < value.length; i++) {
    if (value[i]! >= value[peakIdx]!) {
      close(i);
      peakIdx = i;
      troughIdx = i;
    } else if (value[i]! < value[troughIdx]!) {
      troughIdx = i;
    }
  }
  close(null);
  return episodes.sort((a, b) => a.depth - b.depth).slice(0, top);
}

export interface RiskContribution {
  weight: number;
  /** Share of total portfolio variance attributable to this holding; shares sum to 1. */
  share: number;
}

/** Each holding's share of portfolio variance: w_i * (Sigma w)_i / (w' Sigma w). */
export function riskContributions(
  weights: readonly number[],
  returnsByAsset: readonly (readonly number[])[],
): RiskContribution[] {
  const cov = covarianceMatrix(returnsByAsset);
  const sigmaW = weights.map((_, i) => weights.reduce((a, wj, j) => a + cov[i]![j]! * wj, 0));
  const variance = weights.reduce((a, w, i) => a + w * sigmaW[i]!, 0);
  if (variance <= 0) throw new Error("zero portfolio variance");
  return weights.map((weight, i) => ({ weight, share: (weight * sigmaW[i]!) / variance }));
}
