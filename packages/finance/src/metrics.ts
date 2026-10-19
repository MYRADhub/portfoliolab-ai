export const TRADING_DAYS = 252;

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) throw new Error("mean of empty series");
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (n - 1). */
export function stdev(xs: readonly number[]): number {
  if (xs.length < 2) throw new Error("need at least 2 observations");
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export function annualizedVolatility(returns: readonly number[]): number {
  return stdev(returns) * Math.sqrt(TRADING_DAYS);
}

/** Growth of 1 unit; element 0 is the starting value 1. */
export function cumulativeGrowth(returns: readonly number[]): number[] {
  const out = [1];
  for (const r of returns) out.push(out[out.length - 1]! * (1 + r));
  return out;
}

export function totalReturn(returns: readonly number[]): number {
  return cumulativeGrowth(returns).at(-1)! - 1;
}

/** Geometric annualized return. */
export function annualizedReturn(returns: readonly number[]): number {
  if (returns.length === 0) throw new Error("empty series");
  return (1 + totalReturn(returns)) ** (TRADING_DAYS / returns.length) - 1;
}

/** Largest peak-to-trough decline as a negative fraction (0 if the series never falls). */
export function maxDrawdown(returns: readonly number[]): number {
  let peak = 1;
  let value = 1;
  let worst = 0;
  for (const r of returns) {
    value *= 1 + r;
    peak = Math.max(peak, value);
    worst = Math.min(worst, value / peak - 1);
  }
  return worst;
}

/** Drawdown at each point of the growth series (including the starting point). */
export function drawdownSeries(returns: readonly number[]): number[] {
  const growth = cumulativeGrowth(returns);
  let peak = growth[0]!;
  return growth.map((v) => {
    peak = Math.max(peak, v);
    return v / peak - 1;
  });
}

/** Sharpe = (annualized arithmetic mean return - rf) / annualized volatility. rf is an annual rate. */
export function sharpeRatio(returns: readonly number[], riskFreeAnnual = 0): number {
  const vol = annualizedVolatility(returns);
  if (vol === 0) throw new Error("zero volatility");
  return (mean(returns) * TRADING_DAYS - riskFreeAnnual) / vol;
}
