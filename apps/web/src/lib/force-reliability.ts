/** A force whose t-statistic is at least this far from zero moved reliably in one direction over the window. */
export const RELIABLE_T = 2;

/** True when a force's year of daily returns leaned clearly one way; false for noise-level or unknown t-statistics. */
export function isReliable(t: number | null): boolean {
  return t !== null && Number.isFinite(t) && Math.abs(t) >= RELIABLE_T;
}
