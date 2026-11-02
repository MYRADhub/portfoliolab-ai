import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { classifyAndStore, seedEventTypes, type Classifier } from "@portfolio-lab/classify";
import {
  ingestNews,
  MIN_LINK_SCORE,
  loadAliasIndex,
  matchArticles,
  WebNewsProvider,
  type NewsProvider,
  type WebNewsSearcher,
} from "@portfolio-lab/data";
import { companies, holdings, newsCompanyLinks, portfolios, type Db } from "@portfolio-lab/db";
import { AppError } from "./errors";
import { RateLimiter } from "./rate-limit";

export const SCAN_DAYS = 7;
/** Confidence for a link that rests only on the search that found the article. */
export const SEARCH_LINK_SCORE = 0.55;
export const SCAN_MAX_HOLDINGS = 20;
export const SCAN_LIMIT = { max: 6, windowMs: 60 * 60 * 1000 };
const CLASSIFY_CONCURRENCY = 4;

export interface NewsScanResult {
  range: { from: string; to: string };
  providers: string[];
  tickers: string[];
  fetched: number;
  inserted: number;
  duplicates: number;
  /** New articles linked to at least one company (by name, or by the search that found them). */
  linked: number;
  /** Of those, linked only because a search for the company found them. */
  searchLinked: number;
  classified: number;
  failures: { provider: string; ticker: string; error: string }[];
}

export interface NewsScanDeps {
  web: WebNewsSearcher | null;
  /** A keyed news API such as Finnhub, when configured. */
  feed: NewsProvider | null;
  classifier: Classifier | null;
}

async function inBatches<T>(items: readonly T[], size: number, f: (x: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(f));
}

/**
 * Looks for the last week's news about every holding: on the web and, when configured, in a news feed. New
 * articles are stored with their outlet and link, grouped with near-duplicates, linked to companies by name, and
 * classified with the reasoning kept. Counts against its own hourly allowance.
 */
export async function scanPortfolioNews(
  db: Db,
  sessionId: string,
  portfolioId: string,
  deps: NewsScanDeps,
  opts: { now?: Date; limiter?: RateLimiter } = {},
): Promise<NewsScanResult> {
  const now = opts.now ?? new Date();
  const [p] = await db
    .select({ id: portfolios.id })
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.sessionId, sessionId)));
  if (!p) throw new AppError("not_found", "Portfolio not found");
  if (!deps.web && !deps.feed)
    throw new AppError("unavailable", "No news source is configured on this server");
  const limiter = opts.limiter ?? new RateLimiter(db, SCAN_LIMIT.max, SCAN_LIMIT.windowMs);
  if (!(await limiter.tryAcquire(`news-scan:${sessionId}`)))
    throw new AppError("rate_limited", `News scans are limited to ${SCAN_LIMIT.max} an hour.`);

  const hs = await db
    .select({ ticker: companies.ticker, name: companies.name })
    .from(holdings)
    .innerJoin(companies, eq(companies.id, holdings.companyId))
    .where(eq(holdings.portfolioId, portfolioId))
    .orderBy(asc(companies.ticker))
    .limit(SCAN_MAX_HOLDINGS);
  const tickers = hs.map((h) => h.ticker);
  const range = {
    from: new Date(now.getTime() - SCAN_DAYS * 86_400_000).toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
  const providers: NewsProvider[] = [
    ...(deps.web
      ? [new WebNewsProvider(deps.web, new Map(hs.map((h) => [h.ticker, h.name])), () => now)]
      : []),
    ...(deps.feed ? [deps.feed] : []),
  ];

  const result: NewsScanResult = {
    range,
    providers: providers.map((x) => x.name),
    tickers,
    fetched: 0,
    inserted: 0,
    duplicates: 0,
    linked: 0,
    searchLinked: 0,
    classified: 0,
    failures: [],
  };
  const inserted: number[] = [];
  /** Which company each web article was searched for, for the fallback link below. */
  const searchedFor = new Map<number, string>();
  for (const provider of providers) {
    // Web searches run a few holdings at a time; the feed keeps its own pacing inside ingestNews.
    const groups = provider.name === "web" ? chunk(tickers, 4) : [tickers];
    for (const group of groups) {
      const calls = provider.name === "web" ? group.map((t) => [t]) : [group];
      const parts = await Promise.all(calls.map((ts) => ingestNews(db, provider, ts, range)));
      parts.forEach((s, i) => {
        if (provider.name === "web")
          for (const id of s.insertedIds) searchedFor.set(id, calls[i]![0]!);
      });
      for (const s of parts) {
        result.fetched += s.fetched;
        result.inserted += s.inserted;
        result.duplicates += s.duplicates;
        inserted.push(...s.insertedIds);
        result.failures.push(...s.failures.map((f) => ({ provider: provider.name, ...f })));
      }
    }
  }
  if (inserted.length) {
    const index = await loadAliasIndex(db);
    await matchArticles(db, index, inserted);
    // A web result found by searching for a company, whose text never names it, is linked to that company with
    // a low confidence (just above the cut-off) and its own method, so the reason is visible and it ranks low.
    const named = new Set(
      (
        await db
          .selectDistinct({ articleId: newsCompanyLinks.articleId })
          .from(newsCompanyLinks)
          .where(
            and(
              inArray(newsCompanyLinks.articleId, inserted),
              gte(newsCompanyLinks.score, MIN_LINK_SCORE),
            ),
          )
      ).map((r) => r.articleId),
    );
    const byTicker = new Map(
      (
        await db
          .select({ id: companies.id, ticker: companies.ticker })
          .from(companies)
          .where(inArray(companies.ticker, tickers.length ? tickers : ["-"]))
      ).map((c) => [c.ticker, c.id]),
    );
    const fallback = [...searchedFor]
      .filter(([id, t]) => !named.has(id) && byTicker.has(t))
      .map(([articleId, t]) => ({
        articleId,
        companyId: byTicker.get(t)!,
        method: "web_search",
        score: SEARCH_LINK_SCORE,
      }));
    if (fallback.length) await db.insert(newsCompanyLinks).values(fallback).onConflictDoNothing();
    result.searchLinked = fallback.length;
    const links = await db
      .selectDistinct({ articleId: newsCompanyLinks.articleId })
      .from(newsCompanyLinks)
      .where(
        and(
          inArray(newsCompanyLinks.articleId, inserted),
          gte(newsCompanyLinks.score, MIN_LINK_SCORE),
        ),
      );
    result.linked = links.length;
    if (deps.classifier) {
      await seedEventTypes(db);
      const classifier = deps.classifier;
      await inBatches(inserted, CLASSIFY_CONCURRENCY, async (id) => {
        try {
          const r = await classifyAndStore(db, classifier, id);
          if (r.status === "ok") result.classified++;
        } catch (e) {
          result.failures.push({
            provider: "classifier",
            ticker: String(id),
            error: e instanceof Error ? e.message : "failed",
          });
        }
      });
    }
  }
  return result;
}

function chunk<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
