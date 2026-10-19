import { and, eq, max } from "drizzle-orm";
import { companies, pricesDaily, type Db } from "@portfolio-lab/db";
import type { PriceProvider } from "./providers/types";

export interface IngestResult {
  ticker: string;
  inserted: number;
  from: string;
  to: string;
}

function addDays(date: string, n: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Loads bars for one ticker. Starts the day after the latest stored bar, or at `backfillFrom` when empty.
 * Idempotent: existing (company, date) rows are left unchanged.
 */
export async function ingestPrices(
  db: Db,
  provider: PriceProvider,
  ticker: string,
  opts: { backfillFrom: string; to: string },
): Promise<IngestResult> {
  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.ticker, ticker));
  if (!company) throw new Error(`unknown company ${ticker}`);

  const [latest] = await db
    .select({ d: max(pricesDaily.date) })
    .from(pricesDaily)
    .where(eq(pricesDaily.companyId, company.id));
  const from = latest?.d ? addDays(latest.d, 1) : opts.backfillFrom;
  if (from > opts.to) return { ticker, inserted: 0, from, to: opts.to };

  const bars = await provider.getDailyBars(ticker, from, opts.to);
  let inserted = 0;
  for (let i = 0; i < bars.length; i += 500) {
    const chunk = bars.slice(i, i + 500).map((b) => ({ companyId: company.id, ...b }));
    const rows = await db
      .insert(pricesDaily)
      .values(chunk)
      .onConflictDoNothing()
      .returning({ d: pricesDaily.date });
    inserted += rows.length;
  }
  return { ticker, inserted, from, to: opts.to };
}

/** Days between consecutive stored bars larger than `maxGapDays` (calendar), for gap alerting. */
export async function findPriceGaps(
  db: Db,
  companyId: number,
  maxGapDays = 5,
): Promise<{ after: string; before: string; days: number }[]> {
  const rows = await db
    .select({ d: pricesDaily.date })
    .from(pricesDaily)
    .where(and(eq(pricesDaily.companyId, companyId)))
    .orderBy(pricesDaily.date);
  const gaps: { after: string; before: string; days: number }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const days = (Date.parse(rows[i]!.d) - Date.parse(rows[i - 1]!.d)) / 86_400_000;
    if (days > maxGapDays) gaps.push({ after: rows[i - 1]!.d, before: rows[i]!.d, days });
  }
  return gaps;
}
