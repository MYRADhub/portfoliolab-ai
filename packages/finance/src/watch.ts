import { stdev } from "./metrics";

export interface WatchSignals {
  last: number;
  /** Returns over 1, 5 and 21 trading days; null when the history is too short. */
  d1: number | null;
  d5: number | null;
  d21: number | null;
  /** Latest daily return in units of the stock's own normal daily noise (prior year). Null without enough history. */
  z1: number | null;
  high52: number;
  low52: number;
  /** Distance below the 52-week high (zero or negative) and above the 52-week low (zero or positive). */
  fromHigh: number;
  fromLow: number;
}

export type AlertKind = "big_move" | "near_high" | "near_low" | "falling";

export interface WatchAlert {
  kind: AlertKind;
  /** Higher is more urgent. */
  severity: 1 | 2;
  text: string;
}

/** Thresholds for the watchlist alerts, in one place. */
export const WATCH_RULES = {
  /** Latest move at least this many normal-noise units in either direction. */
  bigMoveZ: 2,
  /** Within this share of the 52-week high or low. */
  nearEdge: 0.03,
  /** A 21-day fall at least this large. */
  fall: -0.1,
  /** Prior daily returns needed before a z-score is reported. */
  minNoiseDays: 60,
} as const;

const TRADING_YEAR = 252;

/**
 * Facts about the latest closes of one stock. `closes` are adjusted closes, oldest first, at least two. The 52-week
 * range uses the last 252 closes; the noise estimate uses the daily returns before the latest day.
 */
export function watchSignals(closes: readonly number[]): WatchSignals {
  if (closes.length < 2) throw new Error("need at least 2 closes");
  if (closes.some((c) => !(c > 0))) throw new Error("closes must be positive");
  const n = closes.length;
  const last = closes[n - 1]!;
  const back = (k: number) => (n > k ? last / closes[n - 1 - k]! - 1 : null);
  const rets = closes.slice(1).map((c, i) => c / closes[i]! - 1);
  const prior = rets.slice(-TRADING_YEAR - 1, -1);
  const sd = prior.length >= WATCH_RULES.minNoiseDays ? stdev(prior) : null;
  const year = closes.slice(-TRADING_YEAR);
  const high52 = Math.max(...year);
  const low52 = Math.min(...year);
  return {
    last,
    d1: back(1),
    d5: back(5),
    d21: back(21),
    z1: sd !== null && sd > 0 ? rets[rets.length - 1]! / sd : null,
    high52,
    low52,
    fromHigh: last / high52 - 1,
    fromLow: last / low52 - 1,
  };
}

const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;

/** The alerts that apply to a set of signals, most urgent first. Every alert states the figure that triggered it. */
export function watchAlerts(s: WatchSignals): WatchAlert[] {
  const out: WatchAlert[] = [];
  if (s.z1 !== null && Math.abs(s.z1) >= WATCH_RULES.bigMoveZ && s.d1 !== null)
    out.push({
      kind: "big_move",
      severity: 2,
      text: `Moved ${s.d1 >= 0 ? "+" : ""}${pct(s.d1)} in the latest session, ${Math.abs(s.z1).toFixed(1)} times its normal daily swing.`,
    });
  if (s.d21 !== null && s.d21 <= WATCH_RULES.fall)
    out.push({
      kind: "falling",
      severity: 2,
      text: `Down ${pct(Math.abs(s.d21))} over the last 21 trading days.`,
    });
  if (s.fromLow <= WATCH_RULES.nearEdge)
    out.push({
      kind: "near_low",
      severity: 1,
      text: `Within ${pct(WATCH_RULES.nearEdge, 0)} of its 52-week low (${pct(s.fromLow)} above it).`,
    });
  if (-s.fromHigh <= WATCH_RULES.nearEdge)
    out.push({
      kind: "near_high",
      severity: 1,
      text: `Within ${pct(WATCH_RULES.nearEdge, 0)} of its 52-week high (${pct(-s.fromHigh)} below it).`,
    });
  return out.sort((a, b) => b.severity - a.severity);
}
