import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { MIN_LINK_SCORE } from "@portfolio-lab/data";
import {
  companies,
  newsArticles,
  newsCompanyLinks,
  pricesDaily,
  watchlistItems,
  type Db,
} from "@portfolio-lab/db";
import {
  watchAlerts,
  watchSignals,
  type WatchAlert,
  type WatchSignals,
} from "@portfolio-lab/finance";
import { AppError } from "./errors";

export const MAX_WATCHED = 30;
export const NEWS_WINDOW_DAYS = 7;
/** Calendar days of prices read per company: enough for a 252-trading-day range and the noise estimate. */
const PRICE_DAYS = 460;
const MIN_CLOSES = 22;

export interface WatchedCompany {
  ticker: string;
  name: string;
  sector: string | null;
  asOf: string | null;
  /** Null when the company has too little price history to say anything. */
  signals: WatchSignals | null;
  alerts: WatchAlert[];
  news: { count: number; latest: { title: string; url: string; publishedAt: string } | null };
}

export interface Watchlist {
  items: WatchedCompany[];
  max: number;
  /** Every alert across the list, most urgent first, tagged with its company. */
  alerts: { ticker: string; alert: WatchAlert }[];
}

async function companyByTicker(db: Db, tickerInput: string) {
  const [c] = await db
    .select()
    .from(companies)
    .where(eq(companies.ticker, tickerInput.trim().toUpperCase()));
  if (!c) throw new AppError("not_found", "Company not found");
  return c;
}

/** Adds a company to the visitor's list. Adding one that is already there changes nothing. */
export async function addToWatchlist(db: Db, sessionId: string, tickerInput: string) {
  const c = await companyByTicker(db, tickerInput);
  const current = await db
    .select({ id: watchlistItems.companyId })
    .from(watchlistItems)
    .where(eq(watchlistItems.sessionId, sessionId));
  if (current.some((r) => r.id === c.id)) return;
  if (current.length >= MAX_WATCHED)
    throw new AppError("conflict", `The watchlist holds at most ${MAX_WATCHED} companies`);
  await db.insert(watchlistItems).values({ sessionId, companyId: c.id }).onConflictDoNothing();
}

/** Removes a company; removing one that is not on the list changes nothing. */
export async function removeFromWatchlist(db: Db, sessionId: string, tickerInput: string) {
  const c = await companyByTicker(db, tickerInput);
  await db
    .delete(watchlistItems)
    .where(and(eq(watchlistItems.sessionId, sessionId), eq(watchlistItems.companyId, c.id)));
}

/** The visitor's companies with their latest price facts, alerts from fixed rules, and recent relevant news. */
export async function getWatchlist(
  db: Db,
  sessionId: string,
  opts: { now?: Date } = {},
): Promise<Watchlist> {
  const { now = new Date() } = opts;
  const rows = await db
    .select({ company: companies, createdAt: watchlistItems.createdAt })
    .from(watchlistItems)
    .innerJoin(companies, eq(companies.id, watchlistItems.companyId))
    .where(eq(watchlistItems.sessionId, sessionId))
    .orderBy(asc(watchlistItems.createdAt), asc(companies.ticker));
  if (rows.length === 0) return { items: [], max: MAX_WATCHED, alerts: [] };
  const ids = rows.map((r) => r.company.id);

  const since = new Date(now.getTime() - PRICE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const prices = await db
    .select({ id: pricesDaily.companyId, date: pricesDaily.date, close: pricesDaily.adjClose })
    .from(pricesDaily)
    .where(and(inArray(pricesDaily.companyId, ids), gte(pricesDaily.date, since)))
    .orderBy(asc(pricesDaily.date));
  const closes = new Map<number, { date: string; close: number }[]>();
  for (const p of prices) {
    const list = closes.get(p.id) ?? [];
    list.push({ date: p.date, close: p.close });
    closes.set(p.id, list);
  }

  const newsRows = await db
    .select({
      id: newsCompanyLinks.companyId,
      title: newsArticles.title,
      url: newsArticles.url,
      publishedAt: newsArticles.publishedAt,
    })
    .from(newsCompanyLinks)
    .innerJoin(newsArticles, eq(newsArticles.id, newsCompanyLinks.articleId))
    .where(
      and(
        inArray(newsCompanyLinks.companyId, ids),
        gte(newsCompanyLinks.score, MIN_LINK_SCORE),
        gte(newsArticles.publishedAt, new Date(now.getTime() - NEWS_WINDOW_DAYS * 86_400_000)),
      ),
    )
    .orderBy(desc(newsArticles.publishedAt));

  const items: WatchedCompany[] = rows.map(({ company: c }) => {
    const series = closes.get(c.id) ?? [];
    const signals = series.length >= MIN_CLOSES ? watchSignals(series.map((p) => p.close)) : null;
    const mine = newsRows.filter((n) => n.id === c.id);
    const latest = mine[0];
    return {
      ticker: c.ticker,
      name: c.name,
      sector: c.sector,
      asOf: series.at(-1)?.date ?? null,
      signals,
      alerts: signals ? watchAlerts(signals) : [],
      news: {
        count: mine.length,
        latest: latest
          ? {
              title: latest.title,
              url: latest.url,
              publishedAt: latest.publishedAt.toISOString(),
            }
          : null,
      },
    };
  });
  const alerts = items
    .flatMap((i) => i.alerts.map((alert) => ({ ticker: i.ticker, alert })))
    .sort((a, b) => b.alert.severity - a.alert.severity || a.ticker.localeCompare(b.ticker));
  return { items, max: MAX_WATCHED, alerts };
}
