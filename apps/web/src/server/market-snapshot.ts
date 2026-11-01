import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { benchmarkPrices, companies, fundamentals, pricesDaily, type Db } from "@portfolio-lab/db";
import {
  annualizedVolatility,
  fundamentalRatios,
  maxDrawdown,
  type FiscalYear,
  type FundamentalRatios,
} from "@portfolio-lab/finance";
import { exposureMap } from "./research";

/** Trading days per window, counted back from the latest close. */
export const WINDOW_DAYS = { "1m": 21, "3m": 63, "6m": 126, "1y": 252 } as const;

export interface CompanySnapshot {
  id: number;
  ticker: string;
  name: string;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  asOf: string | null;
  last: number | null;
  r1m: number | null;
  r3m: number | null;
  r6m: number | null;
  r1y: number | null;
  /** Annualized, over the last year of daily returns. */
  volatility: number | null;
  maxDrawdown: number | null;
  ratios: FundamentalRatios | null;
  /** Signed exposure scores by factor slug, -3 to 3. */
  exposures: Record<string, number>;
}

const FIELD: Record<string, keyof Omit<FiscalYear, "fiscalYear">> = {
  revenue: "revenue",
  net_income: "netIncome",
  operating_income: "operatingIncome",
  eps_diluted: "epsDiluted",
  operating_cash_flow: "operatingCashFlow",
  total_assets: "totalAssets",
  equity: "equity",
};

export function emptyYear(fiscalYear: number): FiscalYear {
  return {
    fiscalYear,
    revenue: null,
    netIncome: null,
    operatingIncome: null,
    epsDiluted: null,
    operatingCashFlow: null,
    totalAssets: null,
    equity: null,
  };
}

/** Fundamentals rows grouped into fiscal years per company, newest year first. */
export function groupFundamentals(
  rows: readonly { companyId: number; metric: string; fiscalYear: number; value: number }[],
): Map<number, FiscalYear[]> {
  const by = new Map<number, Map<number, FiscalYear>>();
  for (const r of rows) {
    const field = FIELD[r.metric];
    if (!field) continue;
    const years = by.get(r.companyId) ?? new Map<number, FiscalYear>();
    const y = years.get(r.fiscalYear) ?? emptyYear(r.fiscalYear);
    y[field] = r.value;
    years.set(r.fiscalYear, y);
    by.set(r.companyId, years);
  }
  return new Map(
    [...by].map(([id, years]) => [
      id,
      [...years.values()].sort((a, b) => b.fiscalYear - a.fiscalYear),
    ]),
  );
}

/** Return over the last `n` daily returns, or null when the history is shorter. */
function trailing(closes: readonly number[], n: number): number | null {
  if (closes.length <= n) return null;
  const start = closes[closes.length - 1 - n]!;
  return start > 0 ? closes[closes.length - 1]! / start - 1 : null;
}

export function priceStats(closes: readonly number[]) {
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++)
    if (closes[i - 1]! > 0) rets.push(closes[i]! / closes[i - 1]! - 1);
  return {
    r1m: trailing(closes, WINDOW_DAYS["1m"]),
    r3m: trailing(closes, WINDOW_DAYS["3m"]),
    r6m: trailing(closes, WINDOW_DAYS["6m"]),
    // A year needs nearly a full year of closes; a few missing days are allowed.
    r1y: closes.length > 240 ? closes[closes.length - 1]! / closes[0]! - 1 : null,
    volatility: rets.length >= 30 ? annualizedVolatility(rets) : null,
    maxDrawdown: rets.length >= 30 ? maxDrawdown(rets) : null,
  };
}

const CACHE_MS = 10 * 60 * 1000;
const cache = new WeakMap<Db, { key: string; at: number; value: Promise<CompanySnapshot[]> }>();

/**
 * One row per company with trailing returns, risk, latest fundamentals and exposures. Built from a single pass over
 * the last year of prices and cached for ten minutes per database and day, since screens and comparisons reuse it.
 */
export function marketSnapshot(db: Db, now: Date = new Date()): Promise<CompanySnapshot[]> {
  const key = now.toISOString().slice(0, 10);
  const hit = cache.get(db);
  if (hit && hit.key === key && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = buildSnapshot(db, now);
  cache.set(db, { key, at: Date.now(), value });
  value.catch(() => cache.delete(db));
  return value;
}

async function buildSnapshot(db: Db, now: Date): Promise<CompanySnapshot[]> {
  const today = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - 372 * 86_400_000).toISOString().slice(0, 10);
  const list = await db
    .select({
      id: companies.id,
      ticker: companies.ticker,
      name: companies.name,
      sector: companies.sector,
      industry: companies.industry,
      marketCap: companies.marketCap,
    })
    .from(companies);
  const prices = await db
    .select({
      companyId: pricesDaily.companyId,
      date: pricesDaily.date,
      adjClose: pricesDaily.adjClose,
    })
    .from(pricesDaily)
    .where(and(gte(pricesDaily.date, since), lte(pricesDaily.date, today)))
    .orderBy(asc(pricesDaily.companyId), asc(pricesDaily.date));
  const closes = new Map<number, { dates: string[]; closes: number[] }>();
  for (const p of prices) {
    const s = closes.get(p.companyId) ?? { dates: [], closes: [] };
    s.dates.push(p.date);
    s.closes.push(p.adjClose);
    closes.set(p.companyId, s);
  }
  const funds = groupFundamentals(
    await db
      .select({
        companyId: fundamentals.companyId,
        metric: fundamentals.metric,
        fiscalYear: fundamentals.fiscalYear,
        value: fundamentals.value,
      })
      .from(fundamentals),
  );
  const exps = await exposureMap(db);

  return list.map((c) => {
    const s = closes.get(c.id);
    const last = s?.closes.at(-1) ?? null;
    const stats = s ? priceStats(s.closes) : null;
    return {
      ...c,
      asOf: s?.dates.at(-1) ?? null,
      last,
      r1m: stats?.r1m ?? null,
      r3m: stats?.r3m ?? null,
      r6m: stats?.r6m ?? null,
      r1y: stats?.r1y ?? null,
      volatility: stats?.volatility ?? null,
      maxDrawdown: stats?.maxDrawdown ?? null,
      ratios: fundamentalRatios(funds.get(c.id) ?? [], last),
      exposures: exps.get(c.id) ?? {},
    };
  });
}

export const BENCHMARK_TICKER = "SPY";

/** Adjusted closes since `since` for a company ticker, or for SPY from the benchmark table. */
export async function closesFor(
  db: Db,
  ticker: string,
  since: string,
): Promise<{ date: string; close: number }[] | null> {
  const t = ticker.toUpperCase();
  if (t === BENCHMARK_TICKER) {
    const rows = await db
      .select({ date: benchmarkPrices.date, close: benchmarkPrices.adjClose })
      .from(benchmarkPrices)
      .where(and(eq(benchmarkPrices.symbol, BENCHMARK_TICKER), gte(benchmarkPrices.date, since)))
      .orderBy(asc(benchmarkPrices.date));
    return rows.length ? rows : null;
  }
  const [c] = await db.select({ id: companies.id }).from(companies).where(eq(companies.ticker, t));
  if (!c) return null;
  return db
    .select({ date: pricesDaily.date, close: pricesDaily.adjClose })
    .from(pricesDaily)
    .where(and(eq(pricesDaily.companyId, c.id), gte(pricesDaily.date, since)))
    .orderBy(asc(pricesDaily.date));
}

/** Annual fundamentals for some companies, newest year first. */
export async function fundamentalsFor(db: Db, ids: readonly number[]) {
  if (ids.length === 0) return new Map<number, FiscalYear[]>();
  return groupFundamentals(
    await db
      .select({
        companyId: fundamentals.companyId,
        metric: fundamentals.metric,
        fiscalYear: fundamentals.fiscalYear,
        value: fundamentals.value,
      })
      .from(fundamentals)
      .where(inArray(fundamentals.companyId, [...ids])),
  );
}

/** Every k-th point so a chart has at most `max` points; the last point is always kept. */
export function thin<T>(points: readonly T[], max = 260): T[] {
  if (points.length <= max) return [...points];
  const step = Math.ceil(points.length / max);
  const out = points.filter((_, i) => i % step === 0);
  if (out.at(-1) !== points.at(-1)) out.push(points.at(-1)!);
  return out;
}
