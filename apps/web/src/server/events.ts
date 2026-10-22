import { and, asc, eq, gte, lte } from "drizzle-orm";
import { eventTradingDate, MIN_LINK_SCORE } from "@portfolio-lab/data";
import {
  companies,
  eventTypes,
  newsArticles,
  newsCompanyLinks,
  pricesDaily,
  type Db,
} from "@portfolio-lab/db";
import {
  aggregate,
  HORIZONS,
  reactionZ,
  studyEvent,
  type Aggregate,
  type EventStudyResult,
} from "@portfolio-lab/finance";
import { latestClassifications, mergeClusters, type LinkRow } from "./news-links";

/** Events are studied over this many years; prices are loaded further back to fit each event's market model. */
export const STUDY_YEARS = 3;
export const ESTIMATION_LOOKBACK_DAYS = 400;
export const MAX_EVENTS = 10000;
const CACHE_MS = 5 * 60 * 1000;
let cached: { at: number; report: EventStudyReport } | null = null;
export const REACTIONS_SHOWN = 40;
/** The market proxy for a stock is the average of at least this many other stocks on the same day. */
export const MIN_PEERS = 5;

/** Event types that mean earnings or guidance news: other news within a week of one is hard to separate from it. */
export const EARNINGS_TYPES = new Set([
  "earnings_release",
  "earnings_beat",
  "earnings_miss",
  "guidance_raise",
  "guidance_cut",
]);
export const OVERLAP_DAYS = 7;

/** Sets `overlapsEarnings` on every non-earnings reaction that has an earnings-type event for the same stock within a week. */
export function markEarningsOverlap(
  reactions: {
    ticker: string;
    eventType: string | null;
    eventDate: string;
    overlapsEarnings: boolean;
  }[],
): void {
  const dates = new Map<string, string[]>();
  for (const r of reactions)
    if (r.eventType && EARNINGS_TYPES.has(r.eventType))
      dates.set(r.ticker, [...(dates.get(r.ticker) ?? []), r.eventDate]);
  const dayMs = 86_400_000;
  for (const r of reactions) {
    if (r.eventType && EARNINGS_TYPES.has(r.eventType)) continue;
    r.overlapsEarnings = (dates.get(r.ticker) ?? []).some(
      (d) => Math.abs(Date.parse(d) - Date.parse(r.eventDate)) <= OVERLAP_DAYS * dayMs,
    );
  }
}

export interface EventReaction {
  title: string;
  url: string;
  source: string | null;
  ticker: string;
  eventType: string | null;
  class: string;
  /** The trading date whose price first reflects the story. */
  eventDate: string;
  /** True when an earnings or guidance event for the same stock falls within a week, which blurs this reaction. */
  overlapsEarnings: boolean;
  /** Event-day abnormal return: actual minus what the market model predicted. */
  ar0: number;
  /** ar0 in units of the stock's normal noise. Above 2 in size is unusual. */
  z0: number | null;
  beta: number;
  car: { horizon: number; value: number; t: number | null }[];
}

export interface EventTypeStudy {
  slug: string;
  name: string;
  n: number;
  /** Events left out of the averages because they overlap earnings news. */
  excludedOverlap: number;
  /** Average size of the event-day move, ignoring direction. */
  typicalMove: number | null;
  /** Share of events whose event-day move was more than twice the stock's normal noise. */
  unusualShare: number | null;
  horizons: { horizon: number; stats: Aggregate }[];
}

export interface EventStudyReport {
  window: { from: string; to: string };
  /** Number of stocks with prices in the window, which form the market proxy. */
  universe: number;
  eventsFound: number;
  eventsStudied: number;
  skipped: Record<string, number>;
  reactions: EventReaction[];
  byType: EventTypeStudy[];
}

interface Market {
  /** Per-ticker returns by date. */
  returns: Map<string, Map<string, number>>;
  sum: Map<string, number>;
  count: Map<string, number>;
}

async function loadMarket(db: Db, from: string, to: string): Promise<Market> {
  const rows = await db
    .select({ ticker: companies.ticker, date: pricesDaily.date, adjClose: pricesDaily.adjClose })
    .from(pricesDaily)
    .innerJoin(companies, eq(companies.id, pricesDaily.companyId))
    .where(and(gte(pricesDaily.date, from), lte(pricesDaily.date, to)))
    .orderBy(asc(companies.ticker), asc(pricesDaily.date));
  const returns = new Map<string, Map<string, number>>();
  const sum = new Map<string, number>();
  const count = new Map<string, number>();
  let prev: { ticker: string; close: number } | null = null;
  for (const r of rows) {
    if (prev && prev.ticker === r.ticker && prev.close > 0) {
      const ret = r.adjClose / prev.close - 1;
      const m = returns.get(r.ticker) ?? new Map<string, number>();
      m.set(r.date, ret);
      returns.set(r.ticker, m);
      sum.set(r.date, (sum.get(r.date) ?? 0) + ret);
      count.set(r.date, (count.get(r.date) ?? 0) + 1);
    }
    prev = { ticker: r.ticker, close: r.adjClose };
  }
  return { returns, sum, count };
}

/** Aligned dates, stock returns and leave-one-out market returns for one ticker. */
function seriesFor(market: Market, ticker: string) {
  const own = market.returns.get(ticker);
  const dates: string[] = [];
  const stock: number[] = [];
  const peers: number[] = [];
  if (!own) return { dates, stock, market: peers };
  for (const date of [...own.keys()].sort()) {
    const c = (market.count.get(date) ?? 0) - 1;
    if (c < MIN_PEERS) continue;
    dates.push(date);
    stock.push(own.get(date)!);
    peers.push((market.sum.get(date)! - own.get(date)!) / c);
  }
  return { dates, stock, market: peers };
}

/**
 * How stocks reacted to classified news: for each story and each stock it is linked to, the abnormal return around
 * the event day, plus the average reaction for each event type. The market proxy is the equal-weighted average of
 * the other stocks in our price universe, so with a small universe the results are rough.
 */
export async function getEventStudy(db: Db, opts: { now?: Date } = {}): Promise<EventStudyReport> {
  if (!opts.now && cached && Date.now() - cached.at < CACHE_MS) return cached.report;
  const report = await computeEventStudy(db, opts.now ?? new Date());
  if (!opts.now) cached = { at: Date.now(), report };
  return report;
}

async function computeEventStudy(db: Db, now: Date): Promise<EventStudyReport> {
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - STUDY_YEARS * 365 * 86_400_000).toISOString().slice(0, 10);
  const priceFrom = new Date(Date.parse(from) - ESTIMATION_LOOKBACK_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const market = await loadMarket(db, priceFrom, to);
  const seriesCache = new Map<string, ReturnType<typeof seriesFor>>();

  const linkRows = await db
    .select({
      id: newsArticles.id,
      title: newsArticles.title,
      url: newsArticles.url,
      source: newsArticles.sourceName,
      publishedAt: newsArticles.publishedAt,
      session: newsArticles.marketSession,
      clusterId: newsArticles.clusterId,
      companyId: newsCompanyLinks.companyId,
      score: newsCompanyLinks.score,
      ticker: companies.ticker,
    })
    .from(newsCompanyLinks)
    .innerJoin(newsArticles, eq(newsArticles.id, newsCompanyLinks.articleId))
    .innerJoin(companies, eq(companies.id, newsCompanyLinks.companyId))
    .where(
      and(
        gte(newsCompanyLinks.score, MIN_LINK_SCORE),
        gte(newsArticles.publishedAt, new Date(`${from}T00:00:00Z`)),
        lte(newsArticles.publishedAt, now),
      ),
    );
  const tickerOf = new Map(linkRows.map((r) => [r.companyId, r.ticker]));
  const merged = mergeClusters(linkRows as (LinkRow & { ticker: string })[]);
  const classes = await latestClassifications(
    db,
    merged.map((m) => m.earliest.id),
  );
  const typeNames = new Map(
    (await db.select({ slug: eventTypes.slug, name: eventTypes.name }).from(eventTypes)).map(
      (t) => [t.slug, t.name],
    ),
  );

  const skipped: Record<string, number> = {};
  const skip = (reason: string) => (skipped[reason] = (skipped[reason] ?? 0) + 1);
  const reactions: EventReaction[] = [];
  const perType = new Map<string, EventReaction[]>();
  let found = 0;

  const events = merged
    .flatMap((m) =>
      [...m.perCompany.keys()].map((companyId) => ({ m, ticker: tickerOf.get(companyId)! })),
    )
    .sort((a, b) => b.m.earliest.publishedAt.getTime() - a.m.earliest.publishedAt.getTime())
    .slice(0, MAX_EVENTS);

  for (const { m, ticker } of events) {
    found++;
    const cl = classes.get(m.earliest.id);
    if (!cl) {
      skip("not_classified");
      continue;
    }
    const eventDate = eventTradingDate(m.earliest.publishedAt);
    let s = seriesCache.get(ticker);
    if (!s) seriesCache.set(ticker, (s = seriesFor(market, ticker)));
    const r: EventStudyResult = studyEvent({ ...s, eventDate });
    if (!r.ok) {
      skip(r.reason);
      continue;
    }
    const ar0 = r.ar.find((a) => a.offset === 0)?.value;
    if (ar0 === undefined) {
      skip("no_event_day");
      continue;
    }
    const reaction: EventReaction = {
      title: m.earliest.title,
      url: m.earliest.url,
      source: m.earliest.source,
      ticker,
      eventType: cl.eventType,
      class: cl.class,
      eventDate,
      overlapsEarnings: false,
      ar0,
      z0: reactionZ(ar0, r.model.sigma),
      beta: r.model.beta,
      car: r.car,
    };
    reactions.push(reaction);
    if (cl.eventType) perType.set(cl.eventType, [...(perType.get(cl.eventType) ?? []), reaction]);
  }

  // Flag news that falls within a week of an earnings or guidance event for the same stock.
  markEarningsOverlap(reactions);

  const byType: EventTypeStudy[] = [...perType.entries()]
    .map(([slug, all]) => {
      const list = all.filter((e) => !e.overlapsEarnings);
      return {
        slug,
        name: typeNames.get(slug) ?? slug,
        n: list.length,
        excludedOverlap: all.length - list.length,
        typicalMove: list.length
          ? list.reduce((s, e) => s + Math.abs(e.ar0), 0) / list.length
          : null,
        unusualShare: list.length
          ? list.filter((e) => e.z0 !== null && Math.abs(e.z0) >= 2).length / list.length
          : null,
        horizons: HORIZONS.flatMap((h) => {
          const values = list.flatMap((e) =>
            e.car.filter((c) => c.horizon === h).map((c) => c.value),
          );
          return values.length ? [{ horizon: h, stats: aggregate(values, 1) }] : [];
        }),
      };
    })
    .sort((a, b) => b.n - a.n || a.slug.localeCompare(b.slug));

  reactions.sort(
    (a, b) => Math.abs(b.z0 ?? 0) - Math.abs(a.z0 ?? 0) || a.title.localeCompare(b.title),
  );
  return {
    window: { from, to },
    universe: market.returns.size,
    eventsFound: found,
    eventsStudied: reactions.length,
    skipped,
    reactions: reactions.slice(0, REACTIONS_SHOWN),
    byType,
  };
}
