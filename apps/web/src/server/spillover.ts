import { and, desc, eq, gte, lte } from "drizzle-orm";
import { eventTradingDate, MIN_LINK_SCORE } from "@portfolio-lab/data";
import { companies, newsArticles, newsCompanyLinks, type Db } from "@portfolio-lab/db";
import {
  aggregate,
  exposureSimilarity,
  MIN_SPILLOVER_STOCKS,
  pooledSpillover,
  spilloverFigures,
  studyEvent,
  type Aggregate,
  type PooledEventInput,
  type PooledSpillover,
} from "@portfolio-lab/finance";
import { AppError } from "./errors";
import {
  EARNINGS_TYPES,
  ESTIMATION_LOOKBACK_DAYS,
  loadMarket,
  seriesFor,
  STUDY_YEARS,
} from "./events";
import { latestClassifications } from "./news-links";
import { exposureMap } from "./research";

/** Large, widely followed companies offered as starting points. Only those with enough earnings history are listed. */
export const BELLWETHERS = [
  "NVDA",
  "AAPL",
  "MSFT",
  "AMZN",
  "GOOGL",
  "META",
  "JPM",
  "XOM",
  "TSLA",
  "AVGO",
  "WMT",
  "UNH",
];
export const MIN_ELIGIBLE_EVENTS = 4;
export const DEFAULT_EVENTS = 12;

export interface SpilloverEvent {
  date: string;
  /** The event company's abnormal return on the event day. */
  ar0: number;
  /** Stocks compared on this day. */
  stocks: number;
  correlation: number | null;
  /** Correlation with similarity after removing sector membership. */
  partialCorrelation: number | null;
  similarMean: number | null;
  dissimilarMean: number | null;
}

export interface Spillover {
  ticker: string;
  name: string;
  events: SpilloverEvent[];
  /** Mean of the per-event correlations, with its t-statistic and bootstrap range. Null with no usable events. */
  summary: Aggregate | null;
  /** The same for the sector-adjusted (partial) correlations: does similarity matter beyond the sector label? */
  partialSummary: Aggregate | null;
  /** Mean signed move of the most and least similar fifths, over events that report them. */
  similarMean: number | null;
  dissimilarMean: number | null;
  minStocks: number;
}

async function earningsDates(db: Db, companyId: number, since: Date, now: Date): Promise<string[]> {
  const rows = await db
    .select({ id: newsArticles.id, publishedAt: newsArticles.publishedAt })
    .from(newsCompanyLinks)
    .innerJoin(newsArticles, eq(newsArticles.id, newsCompanyLinks.articleId))
    .where(
      and(
        eq(newsCompanyLinks.companyId, companyId),
        gte(newsCompanyLinks.score, MIN_LINK_SCORE),
        gte(newsArticles.publishedAt, since),
        lte(newsArticles.publishedAt, now),
      ),
    )
    .orderBy(desc(newsArticles.publishedAt));
  const cls = await latestClassifications(
    db,
    rows.map((r) => r.id),
  );
  const dates = new Set<string>();
  for (const r of rows) {
    const t = cls.get(r.id)?.eventType;
    if (t && EARNINGS_TYPES.has(t)) dates.add(eventTradingDate(r.publishedAt));
  }
  return [...dates].sort().reverse();
}

/** Bellwethers with enough earnings history to run the test on. */
export async function eligibleBellwethers(db: Db, now = new Date()): Promise<string[]> {
  const since = new Date(now.getTime() - STUDY_YEARS * 365 * 86_400_000);
  const rows = await db.select().from(companies);
  const profiles = await exposureMap(db);
  const out: string[] = [];
  for (const t of BELLWETHERS) {
    const c = rows.find((r) => r.ticker === t);
    if (!c || !profiles.has(c.id)) continue;
    if ((await earningsDates(db, c.id, since, now)).length >= MIN_ELIGIBLE_EVENTS) out.push(t);
  }
  return out;
}

interface RawEvent {
  date: string;
  ar0: number;
  similarity: number[];
  signedMove: number[];
  sameSector: number[];
}

type CompanyRow = typeof companies.$inferSelect;

/** Everything the test needs, loaded once so many companies can share the same price history. */
async function spilloverContext(db: Db, now: Date) {
  const all = await db.select().from(companies);
  const profiles = await exposureMap(db);
  const since = new Date(now.getTime() - STUDY_YEARS * 365 * 86_400_000);
  const priceFrom = new Date(since.getTime() - ESTIMATION_LOOKBACK_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const market = await loadMarket(db, priceFrom, now.toISOString().slice(0, 10));
  const series = new Map<string, ReturnType<typeof seriesFor>>();
  const get = (t: string) => {
    let s = series.get(t);
    if (!s) series.set(t, (s = seriesFor(market, t)));
    return s;
  };
  return { all, profiles, since, now, get };
}

type Context = Awaited<ReturnType<typeof spilloverContext>>;

/** For each recent earnings day of `company`: every other profiled stock's similarity, sector flag and signed move. */
async function collectEvents(
  db: Db,
  ctx: Context,
  company: CompanyRow,
  events: number,
): Promise<RawEvent[]> {
  const own = ctx.profiles.get(company.id)!;
  const dates = (await earningsDates(db, company.id, ctx.since, ctx.now)).slice(0, events);
  const others = ctx.all
    .filter((c) => c.id !== company.id && ctx.profiles.has(c.id))
    .map((c) => ({
      ticker: c.ticker,
      sim: exposureSimilarity(own, ctx.profiles.get(c.id)!),
      sameSector: c.sector !== null && c.sector === company.sector ? 1 : 0,
    }))
    .filter((c): c is { ticker: string; sim: number; sameSector: number } => c.sim !== null);

  const out: RawEvent[] = [];
  for (const date of dates) {
    const r0 = studyEvent({ ...ctx.get(company.ticker), eventDate: date });
    if (!r0.ok) continue;
    const ar0 = r0.ar.find((a) => a.offset === 0)?.value;
    if (ar0 === undefined || ar0 === 0) continue;
    const sign = Math.sign(ar0);
    const ev: RawEvent = { date, ar0, similarity: [], signedMove: [], sameSector: [] };
    for (const o of others) {
      const r = studyEvent({ ...ctx.get(o.ticker), eventDate: date });
      if (!r.ok) continue;
      const a = r.ar.find((x) => x.offset === 0)?.value;
      if (a === undefined) continue;
      ev.similarity.push(o.sim);
      ev.signedMove.push(a * sign);
      ev.sameSector.push(o.sameSector);
    }
    out.push(ev);
  }
  return out;
}

/**
 * When `ticker` reports earnings, do stocks whose hidden exposures resemble its own move with it? For each of its last
 * earnings days we line up every other profiled stock's abnormal return (times the sign of the company's own) against
 * how similar its exposures are, and report the correlation. A correlation reliably above zero would be evidence that the
 * exposure scores capture real shared economic drivers; around zero says they do not, or that the effect is small here.
 */
export async function getSpillover(
  db: Db,
  tickerInput: string,
  opts: { events?: number; now?: Date } = {},
): Promise<Spillover> {
  const { events = DEFAULT_EVENTS, now = new Date() } = opts;
  const ctx = await spilloverContext(db, now);
  const company = ctx.all.find((c) => c.ticker === tickerInput.toUpperCase());
  if (!company) throw new AppError("not_found", "Company not found");
  if (!ctx.profiles.has(company.id))
    throw new AppError("bad_request", "This company has no exposure profile");

  const out: SpilloverEvent[] = (await collectEvents(db, ctx, company, events)).map((e) => {
    const f = spilloverFigures(e.similarity, e.signedMove, { sameSector: e.sameSector });
    return {
      date: e.date,
      ar0: e.ar0,
      stocks: f.n,
      correlation: f.correlation,
      partialCorrelation: f.partialCorrelation,
      similarMean: f.similarMean,
      dissimilarMean: f.dissimilarMean,
    };
  });

  const cors = out.map((e) => e.correlation).filter((c): c is number => c !== null);
  const partials = out.map((e) => e.partialCorrelation).filter((c): c is number => c !== null);
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  return {
    ticker: company.ticker,
    name: company.name,
    events: out,
    summary: cors.length ? aggregate(cors, 1) : null,
    partialSummary: partials.length ? aggregate(partials, 1) : null,
    similarMean: avg(out.map((e) => e.similarMean)),
    dissimilarMean: avg(out.map((e) => e.dissimilarMean)),
    minStocks: MIN_SPILLOVER_STOCKS,
  };
}

/** Monday of the week containing an ISO date: events in the same week share market conditions. */
export function weekKey(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export interface PooledReport extends PooledSpillover {
  /** Companies whose earnings days were pooled. */
  companies: string[];
  eventsPerCompany: number;
  minStocks: number;
}

/**
 * The same test over many companies at once. Every earnings day of every eligible bellwether is pooled, events within
 * the same calendar week count as one observation for the uncertainty, and a placebo that reshuffles the similarity
 * scores shows what the result looks like with no real relationship.
 */
export async function getPooledSpillover(
  db: Db,
  opts: { events?: number; permutations?: number; now?: Date } = {},
): Promise<PooledReport> {
  const { events = DEFAULT_EVENTS, permutations = 200, now = new Date() } = opts;
  const ctx = await spilloverContext(db, now);
  const inputs: PooledEventInput[] = [];
  const used: string[] = [];
  for (const t of BELLWETHERS) {
    const c = ctx.all.find((r) => r.ticker === t);
    if (!c || !ctx.profiles.has(c.id)) continue;
    const raw = await collectEvents(db, ctx, c, events);
    if (raw.length < MIN_ELIGIBLE_EVENTS) continue;
    used.push(t);
    for (const e of raw)
      inputs.push({
        cluster: weekKey(e.date),
        similarity: e.similarity,
        signedMove: e.signedMove,
        sameSector: e.sameSector,
      });
  }
  return {
    ...pooledSpillover(inputs, { permutations }),
    companies: used,
    eventsPerCompany: events,
    minStocks: MIN_SPILLOVER_STOCKS,
  };
}
