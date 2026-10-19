import { and, eq, max } from "drizzle-orm";
import { asc, sql } from "drizzle-orm";
import { companies, pricesDaily, type Db } from "@portfolio-lab/db";
import { ProviderError, type PriceProvider } from "./providers/types";

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

export interface UpdateSummary {
  ok: IngestResult[];
  failed: { ticker: string; error: string }[];
  stoppedEarly: "rate_limited" | null;
  remaining: string[];
}

/**
 * Updates up to `limit` tickers, stalest first (never-loaded companies before the rest), so a rate-limited
 * free tier can be worked through over several runs. Stops at the first rate-limit error instead of burning
 * the remaining quota on guaranteed failures. Other per-ticker failures are recorded and skipped.
 */
export async function runUpdate(
  db: Db,
  provider: PriceProvider,
  opts: {
    backfillFrom: string;
    to: string;
    limit?: number;
    tickers?: readonly string[];
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<UpdateSummary> {
  const {
    limit = Infinity,
    delayMs = 0,
    sleep = (ms) => new Promise<void>((r) => setTimeout(r, ms)),
  } = opts;
  const rows = await db
    .select({ ticker: companies.ticker, latest: max(pricesDaily.date) })
    .from(companies)
    .leftJoin(pricesDaily, eq(pricesDaily.companyId, companies.id))
    .groupBy(companies.ticker)
    .orderBy(sql`max(${pricesDaily.date}) asc nulls first`, asc(companies.ticker));

  const wanted = opts.tickers ? new Set(opts.tickers) : null;
  const queue = rows.map((r) => r.ticker).filter((t) => !wanted || wanted.has(t));
  const batch = queue.slice(0, limit);
  const summary: UpdateSummary = { ok: [], failed: [], stoppedEarly: null, remaining: [] };

  for (let i = 0; i < batch.length; i++) {
    const ticker = batch[i]!;
    try {
      summary.ok.push(await ingestPrices(db, provider, ticker, opts));
    } catch (err) {
      if (err instanceof ProviderError && err.kind === "rate_limited") {
        summary.stoppedEarly = "rate_limited";
        summary.remaining = queue.slice(i);
        return summary;
      }
      summary.failed.push({ ticker, error: err instanceof Error ? err.message : String(err) });
    }
    if (delayMs > 0 && i < batch.length - 1) await sleep(delayMs);
  }
  summary.remaining = queue.slice(batch.length);
  return summary;
}
