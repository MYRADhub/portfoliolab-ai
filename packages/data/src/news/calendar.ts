import { and, gte, lte, sql } from "drizzle-orm";
import { pricesDaily, type Db } from "@portfolio-lab/db";

const weekday = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
};

/**
 * Trading-day predicate built from the dates that have price bars, which captures exchange holidays without a
 * hard-coded calendar. A date is a trading day if at least `minBars` companies have a bar on it. Dates after the
 * latest loaded bar are unknown, so they fall back to the weekday rule; dates before the first bar do the same.
 */
export async function loadTradingDays(
  db: Db,
  from: string,
  to: string,
  minBars = 1,
): Promise<(date: string) => boolean> {
  const rows = await db
    .select({ date: pricesDaily.date, n: sql<number>`count(*)::int` })
    .from(pricesDaily)
    .where(and(gte(pricesDaily.date, from), lte(pricesDaily.date, to)))
    .groupBy(pricesDaily.date);
  const days = new Set(rows.filter((r) => r.n >= minBars).map((r) => r.date));
  if (days.size === 0) return weekday;
  const sorted = [...days].sort();
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  return (date) => (date < first || date > last ? weekday(date) : days.has(date));
}
