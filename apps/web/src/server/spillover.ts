import { and, desc, eq, gte, lte } from "drizzle-orm";
import { eventTradingDate, MIN_LINK_SCORE } from "@portfolio-lab/data";
import { companies, newsArticles, newsCompanyLinks, type Db } from "@portfolio-lab/db";
import {
  aggregate,
  exposureSimilarity,
  MIN_SPILLOVER_STOCKS,
  spilloverFigures,
  studyEvent,
  type Aggregate,
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
  const all = await db.select().from(companies);
  const company = all.find((c) => c.ticker === tickerInput.toUpperCase());
  if (!company) throw new AppError("not_found", "Company not found");
  const profiles = await exposureMap(db);
  const own = profiles.get(company.id);
  if (!own) throw new AppError("bad_request", "This company has no exposure profile");

  const since = new Date(now.getTime() - STUDY_YEARS * 365 * 86_400_000);
  const dates = (await earningsDates(db, company.id, since, now)).slice(0, events);
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
  const others = all
    .filter((c) => c.id !== company.id && profiles.has(c.id))
    .map((c) => ({
      ticker: c.ticker,
      sim: exposureSimilarity(own, profiles.get(c.id)!),
      sameSector: c.sector !== null && c.sector === company.sector ? 1 : 0,
    }))
    .filter((c): c is { ticker: string; sim: number; sameSector: number } => c.sim !== null);

  const out: SpilloverEvent[] = [];
  for (const date of dates) {
    const r0 = studyEvent({ ...get(company.ticker), eventDate: date });
    if (!r0.ok) continue;
    const ar0 = r0.ar.find((a) => a.offset === 0)?.value;
    if (ar0 === undefined || ar0 === 0) continue;
    const sign = Math.sign(ar0);
    const xs: number[] = [];
    const ys: number[] = [];
    const sector: number[] = [];
    for (const o of others) {
      const r = studyEvent({ ...get(o.ticker), eventDate: date });
      if (!r.ok) continue;
      const a = r.ar.find((x) => x.offset === 0)?.value;
      if (a === undefined) continue;
      xs.push(o.sim);
      ys.push(a * sign);
      sector.push(o.sameSector);
    }
    const f = spilloverFigures(xs, ys, { sameSector: sector });
    out.push({
      date,
      ar0,
      stocks: f.n,
      correlation: f.correlation,
      partialCorrelation: f.partialCorrelation,
      similarMean: f.similarMean,
      dissimilarMean: f.dissimilarMean,
    });
  }

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
