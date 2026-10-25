import { TRADING_DAYS, annualizedReturn, mean, stdev } from "./metrics";

export interface BenchmarkStats {
  /** Daily observations used. */
  n: number;
  /** How much the portfolio moves per 1 of benchmark movement (slope of portfolio on benchmark daily returns). */
  beta: number | null;
  /** Annualized return left after accounting for beta: daily mean of (portfolio - beta x benchmark), times 252. */
  alpha: number | null;
  correlation: number | null;
  /** Share of the portfolio's day-to-day variation that the benchmark explains. */
  rSquared: number | null;
  /** Annualized standard deviation of the daily difference between portfolio and benchmark. */
  trackingError: number | null;
  /** Annualized return difference divided by tracking error. Null when the two never differ. */
  informationRatio: number | null;
  /** Annualized geometric return of the portfolio minus that of the benchmark. */
  activeReturn: number;
  /** Portfolio's average return on up days over the benchmark's average on those days. */
  upCapture: number | null;
  /** The same on down days: below 1 means the portfolio fell less than the benchmark. */
  downCapture: number | null;
  /** Share of days on which the portfolio beat the benchmark. */
  battingAverage: number;
}

/** Portfolio versus benchmark statistics from aligned daily returns. */
export function benchmarkRelative(
  portfolio: readonly number[],
  benchmark: readonly number[],
): BenchmarkStats {
  const n = portfolio.length;
  if (n !== benchmark.length) throw new Error("series length mismatch");
  if (n < 3) throw new Error("need at least 3 observations");
  const mp = mean(portfolio);
  const mb = mean(benchmark);
  let sbb = 0;
  let spp = 0;
  let spb = 0;
  for (let i = 0; i < n; i++) {
    sbb += (benchmark[i]! - mb) ** 2;
    spp += (portfolio[i]! - mp) ** 2;
    spb += (benchmark[i]! - mb) * (portfolio[i]! - mp);
  }
  const beta = sbb > 1e-18 ? spb / sbb : null;
  const correlation = sbb > 1e-18 && spp > 1e-18 ? spb / Math.sqrt(sbb * spp) : null;
  const active = portfolio.map((p, i) => p - benchmark[i]!);
  const te = stdev(active) * Math.sqrt(TRADING_DAYS);
  const activeReturn = annualizedReturn(portfolio) - annualizedReturn(benchmark);
  const captured = (sign: 1 | -1): number | null => {
    const idx = benchmark
      .map((b, i) => [b, i] as const)
      .filter(([b]) => b * sign > 0)
      .map(([, i]) => i);
    if (idx.length === 0) return null;
    const mbSide = idx.reduce((a, i) => a + benchmark[i]!, 0) / idx.length;
    const mpSide = idx.reduce((a, i) => a + portfolio[i]!, 0) / idx.length;
    return mbSide === 0 ? null : mpSide / mbSide;
  };
  return {
    n,
    beta,
    alpha: beta === null ? null : (mp - beta * mb) * TRADING_DAYS,
    correlation,
    rSquared: correlation === null ? null : correlation ** 2,
    trackingError: te,
    informationRatio: te > 1e-9 ? activeReturn / te : null,
    activeReturn,
    upCapture: captured(1),
    downCapture: captured(-1),
    battingAverage: portfolio.filter((p, i) => p > benchmark[i]!).length / n,
  };
}

/** Beta over a trailing window, one value per day once `window` observations exist. */
export function rollingBeta(
  portfolio: readonly number[],
  benchmark: readonly number[],
  window: number,
): { index: number; beta: number }[] {
  if (portfolio.length !== benchmark.length) throw new Error("series length mismatch");
  const out: { index: number; beta: number }[] = [];
  for (let end = window; end <= portfolio.length; end++) {
    const b = benchmark.slice(end - window, end);
    const p = portfolio.slice(end - window, end);
    const mb = mean(b);
    const mp = mean(p);
    let sbb = 0;
    let spb = 0;
    for (let i = 0; i < window; i++) {
      sbb += (b[i]! - mb) ** 2;
      spb += (b[i]! - mb) * (p[i]! - mp);
    }
    if (sbb > 1e-18) out.push({ index: end - 1, beta: spb / sbb });
  }
  return out;
}
