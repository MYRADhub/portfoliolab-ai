import { mean, stdev } from "./metrics";

/** Trading days of history needed before an event to fit the market model. */
export const MIN_ESTIMATION_DAYS = 60;
/** Estimation window, in trading days before the event: [-250, -30]. */
export const ESTIMATION_START = 250;
export const ESTIMATION_GAP = 30;
/** Event horizons reported, in trading days after the event day (0 is the event day itself). */
export const HORIZONS = [0, 1, 5, 10, 30] as const;
/** Fewer events than this and an aggregate is shown as too small to judge. */
export const MIN_EVENTS = 5;

export interface MarketModel {
  alpha: number;
  beta: number;
  /** Standard deviation of the regression residuals: the stock's normal day-to-day noise around the model. */
  sigma: number;
  n: number;
}

/** Ordinary least squares of stock on market returns. Null if there are too few points or the market never moves. */
export function fitMarketModel(
  stock: readonly number[],
  market: readonly number[],
  minN: number = MIN_ESTIMATION_DAYS,
): MarketModel | null {
  const n = stock.length;
  if (n !== market.length) throw new Error("series length mismatch");
  if (n < Math.max(3, minN)) return null;
  const mx = mean(market);
  const my = mean(stock);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (market[i]! - mx) ** 2;
    sxy += (market[i]! - mx) * (stock[i]! - my);
  }
  if (sxx < 1e-12) return null; // a market that never moves (up to rounding) cannot explain anything
  const beta = sxy / sxx;
  const alpha = my - beta * mx;
  let ssr = 0;
  for (let i = 0; i < n; i++) ssr += (stock[i]! - alpha - beta * market[i]!) ** 2;
  return { alpha, beta, sigma: Math.sqrt(ssr / (n - 2)), n };
}

export interface EventStudyInput {
  /** Ascending trading dates; `stock` and `market` are the returns on those dates, same length. */
  dates: readonly string[];
  stock: readonly number[];
  market: readonly number[];
  /** The first trading date whose price reflects the event. */
  eventDate: string;
}

export type EventStudyResult =
  | {
      ok: true;
      model: MarketModel;
      /** Abnormal return per day offset from the event day, from -1 up to as many days as exist. */
      ar: { offset: number; value: number }[];
      /** Cumulative abnormal return from the event day to each horizon that exists, with a t-statistic. */
      car: { horizon: number; value: number; t: number | null }[];
    }
  | { ok: false; reason: "no_event_day" | "short_history" | "flat_market" };

/**
 * Market-model event study for one event: fit stock = alpha + beta * market on [-250, -30] before the event, then
 * abnormal return = actual - predicted on and after the event day. The t-statistic for a CAR over L days is
 * CAR / (sigma * sqrt(L)), treating residuals as independent.
 */
export function studyEvent(
  input: EventStudyInput,
  minEstimation: number = MIN_ESTIMATION_DAYS,
): EventStudyResult {
  const { dates, stock, market, eventDate } = input;
  if (dates.length !== stock.length || dates.length !== market.length)
    throw new Error("series length mismatch");
  const e = dates.indexOf(eventDate);
  if (e < 1) return { ok: false, reason: "no_event_day" };

  const from = Math.max(1, e - ESTIMATION_START);
  const to = e - ESTIMATION_GAP; // inclusive
  if (to - from + 1 < minEstimation) return { ok: false, reason: "short_history" };
  const model = fitMarketModel(
    stock.slice(from, to + 1),
    market.slice(from, to + 1),
    minEstimation,
  );
  if (!model) return { ok: false, reason: "flat_market" };

  const abnormal = (i: number) => stock[i]! - (model.alpha + model.beta * market[i]!);
  const ar: { offset: number; value: number }[] = [];
  for (let i = e - 1; i < dates.length && i <= e + Math.max(...HORIZONS); i++)
    ar.push({ offset: i - e, value: abnormal(i) });

  const car = HORIZONS.filter((h) => e + h < dates.length).map((h) => {
    const value = ar.filter((a) => a.offset >= 0 && a.offset <= h).reduce((s, a) => s + a.value, 0);
    return {
      horizon: h,
      value,
      t: model.sigma === 0 ? null : value / (model.sigma * Math.sqrt(h + 1)),
    };
  });
  return { ok: true, model, ar, car };
}

/** Event-day abnormal return in units of the stock's normal noise: |z| above 2 is unusual. Null when sigma is 0. */
export function reactionZ(abnormalReturn: number, sigma: number): number | null {
  return sigma > 0 ? abnormalReturn / sigma : null;
}

/** Small seeded generator so bootstrap results are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Aggregate {
  n: number;
  mean: number;
  sd: number | null;
  /** Cross-sectional t-statistic of the mean against zero. Null when n < 2 or the values do not vary. */
  t: number | null;
  /** 95% bootstrap interval for the mean. */
  ci: [number, number];
  /** True when n reaches MIN_EVENTS. Below that the numbers are shown but should not be read as evidence. */
  sufficient: boolean;
}

/** Mean of per-event values with a t-statistic and a seeded 95% bootstrap interval (2000 resamples). */
export function aggregate(values: readonly number[], seed = 1, resamples = 2000): Aggregate {
  const n = values.length;
  if (n === 0) throw new Error("no values");
  const m = mean(values);
  const sd = n >= 2 ? stdev(values) : null;
  const t = sd !== null && sd > 0 ? m / (sd / Math.sqrt(n)) : null;
  const rand = mulberry32(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += values[Math.floor(rand() * n)]!;
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  const ci: [number, number] = [
    means[Math.floor(0.025 * resamples)]!,
    means[Math.min(resamples - 1, Math.floor(0.975 * resamples))]!,
  ];
  return { n, mean: m, sd, t, ci, sufficient: n >= MIN_EVENTS };
}
