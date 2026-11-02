/** Inputs the dashboard already loads; kept structural so the helpers can be tested without the server types. */
export interface SummaryInput {
  monthReturn: number | null;
  holdings: { ticker: string; weight: number; m1: number | null; riskShare: number }[];
  /** Largest hidden force by share of exposure, when exposure data exists. */
  topForce: { name: string; share: number } | null;
  /** Portfolio and S&P 500 values on the same dates (from the market comparison), when available. */
  curves: { dates: string[]; portfolio: number[]; benchmark: number[] } | null;
}

export interface Contribution {
  ticker: string;
  /** Weight x the stock's 1-month return: an approximation of its share of the month's result. */
  points: number;
}

const pts = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(2)} points`;
const pct = (x: number, d = 1) => `${(Math.abs(x) * 100).toFixed(d)}%`;

/** Return over the last `n` steps of a series, or null when it is shorter. */
export function trailingReturn(series: readonly number[], n: number): number | null {
  if (series.length <= n) return null;
  const a = series[series.length - 1 - n]!;
  return a > 0 ? series[series.length - 1]! / a - 1 : null;
}

/** Return since the last value of the previous calendar year. Null without one. */
export function yearToDate(dates: readonly string[], series: readonly number[]): number | null {
  if (!dates.length) return null;
  const year = dates.at(-1)!.slice(0, 4);
  let i = -1;
  for (let k = dates.length - 1; k >= 0; k--)
    if (dates[k]!.slice(0, 4) < year) {
      i = k;
      break;
    }
  if (i < 0 || !(series[i]! > 0)) return null;
  return series.at(-1)! / series[i]! - 1;
}

/** Each holding's approximate share of the month, largest effect first. */
export function contributions(holdings: SummaryInput["holdings"]): Contribution[] {
  return holdings
    .filter((h) => h.m1 !== null)
    .map((h) => ({ ticker: h.ticker, points: h.weight * h.m1! }))
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points) || a.ticker.localeCompare(b.ticker));
}

/** A volatility in words, for people who do not think in standard deviations. */
export function calmness(volatility: number): string {
  if (volatility < 0.12) return "Calm";
  if (volatility < 0.2) return "Moderate";
  if (volatility < 0.3) return "Lively";
  return "Very bumpy";
}

/**
 * The dashboard's opening lines, in plain words. Every number in them is also shown on the page, so the summary
 * never says something the figures do not.
 */
export function summarize(input: SummaryInput): {
  headline: string;
  tone: "gain" | "loss" | "flat";
  lines: string[];
} {
  const m = input.monthReturn;
  const headline =
    m === null
      ? "Not enough history for a monthly result yet"
      : Math.abs(m) < 0.0005
        ? "Flat this month"
        : `${m > 0 ? "Up" : "Down"} ${pct(m)} this month`;
  const tone = m === null || Math.abs(m) < 0.0005 ? "flat" : m > 0 ? "gain" : "loss";
  const lines: string[] = [];

  const spy = input.curves ? trailingReturn(input.curves.benchmark, 21) : null;
  if (m !== null && spy !== null) {
    const gap = m - spy;
    lines.push(
      Math.abs(gap) < 0.0005
        ? `In line with the S&P 500 (${spy >= 0 ? "+" : "−"}${pct(spy)}).`
        : `${Math.abs(gap * 100).toFixed(1)} points ${gap > 0 ? "ahead of" : "behind"} the S&P 500, which moved ${spy >= 0 ? "+" : "−"}${pct(spy)}.`,
    );
  }

  const c = contributions(input.holdings);
  const up = c.filter((x) => x.points > 0.0005).sort((a, b) => b.points - a.points)[0];
  const down = c.filter((x) => x.points < -0.0005).sort((a, b) => a.points - b.points)[0];
  if (up && down)
    lines.push(
      `${up.ticker} added the most (${pts(up.points)}); ${down.ticker} held it back (${pts(down.points)}).`,
    );
  else if (up) lines.push(`${up.ticker} added the most (${pts(up.points)}).`);
  else if (down) lines.push(`${down.ticker} weighed the most (${pts(down.points)}).`);

  const heavy = [...input.holdings]
    .filter((h) => h.weight > 0 && h.riskShare / h.weight >= 1.5 && h.riskShare >= 0.1)
    .sort((a, b) => b.riskShare - a.riskShare)[0];
  if (heavy)
    lines.push(
      `${heavy.ticker} is ${pct(heavy.weight, 0)} of your money but ${pct(heavy.riskShare, 0)} of the ups and downs.`,
    );
  if (input.topForce)
    lines.push(
      `Your largest hidden exposure is ${input.topForce.name}, ${pct(input.topForce.share, 0)} of all exposure.`,
    );
  return { headline, tone, lines };
}
