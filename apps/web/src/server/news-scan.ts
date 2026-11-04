import { and, asc, desc, eq, gte, inArray, or } from "drizzle-orm";
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
import {
  companies,
  holdings,
  newsArticles,
  newsClassifications,
  newsCompanyLinks,
  portfolios,
  type Db,
} from "@portfolio-lab/db";
import { AppError } from "./errors";
import { getNewsAnalysis, type NewsAnalysis } from "./news-analysis";
import { RateLimiter, type Limiter } from "./rate-limit";

export const SCAN_DAYS = 7;
/** Confidence for a link that rests only on the search that found the article. */
export const SEARCH_LINK_SCORE = 0.55;
export const SCAN_MAX_HOLDINGS = 20;
export const SCAN_LIMIT = { max: 6, windowMs: 60 * 60 * 1000 };
/** Classifier calls in flight at once. */
export const CLASSIFY_CONCURRENCY = 8;
/**
 * New stories classified by AI per holding in one scan: the strongest links first, then the newest, one per story
 * cluster. A feed can return hundreds a week; the rest are ranked with a neutral impact until someone opens one and
 * asks for it to be classified.
 */
export const CLASSIFY_PER_HOLDING = 8;
export const CLASSIFY_ONE_LIMIT = { max: 60, windowMs: 60 * 60 * 1000 };

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
  /** New story clusters left unclassified because they were outside the per-holding allowance. */
  unclassified: number;
  failures: { provider: string; ticker: string; error: string }[];
}

export interface NewsScanDeps {
  web: WebNewsSearcher | null;
  /** A keyed news API such as Finnhub, when configured. */
  feed: NewsProvider | null;
  classifier: Classifier | null;
}

/** Runs `f` over `items` with at most `size` calls in flight; a slow call does not hold up the others. */
export async function inPool<T>(items: readonly T[], size: number, f: (x: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await f(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

/**
 * Which stories to classify after a scan. New articles are grouped into their story clusters, and a cluster is
 * represented by its earliest article linked to these companies (the one the News page ranks by). For each held
 * company, its clusters are taken by link confidence and then recency, up to `perHolding`, skipping clusters that
 * are already classified. A cluster chosen for one holding counts for all. `left` is the number of new, still
 * unclassified clusters that were not chosen.
 */
export async function pickForClassification(
  db: Db,
  articleIds: readonly number[],
  companyIds: readonly number[],
  perHolding: number,
): Promise<{ ids: number[]; left: number }> {
  if (!articleIds.length || !companyIds.length) return { ids: [], left: 0 };
  const linked = and(
    inArray(newsCompanyLinks.companyId, [...companyIds]),
    gte(newsCompanyLinks.score, MIN_LINK_SCORE),
  );
  const rows = await db
    .select({
      articleId: newsCompanyLinks.articleId,
      companyId: newsCompanyLinks.companyId,
      clusterId: newsArticles.clusterId,
    })
    .from(newsCompanyLinks)
    .innerJoin(newsArticles, eq(newsArticles.id, newsCompanyLinks.articleId))
    .where(and(inArray(newsCompanyLinks.articleId, [...articleIds]), linked))
    .orderBy(
      desc(newsCompanyLinks.score),
      desc(newsArticles.publishedAt),
      asc(newsCompanyLinks.articleId),
    );
  const keys = [...new Set(rows.map((r) => r.clusterId ?? r.articleId))];
  if (!keys.length) return { ids: [], left: 0 };
  const members = await db
    .selectDistinct({
      id: newsArticles.id,
      clusterId: newsArticles.clusterId,
      publishedAt: newsArticles.publishedAt,
    })
    .from(newsArticles)
    .innerJoin(newsCompanyLinks, eq(newsCompanyLinks.articleId, newsArticles.id))
    .where(and(or(inArray(newsArticles.clusterId, keys), inArray(newsArticles.id, keys)), linked));
  const rep = new Map<number, { id: number; at: Date }>();
  for (const m of members) {
    const key = m.clusterId ?? m.id;
    const cur = rep.get(key);
    if (!cur || m.publishedAt < cur.at || (+m.publishedAt === +cur.at && m.id < cur.id))
      rep.set(key, { id: m.id, at: m.publishedAt });
  }
  const repOf = (key: number) => rep.get(key)?.id ?? key;
  const done = new Set(
    (
      await db
        .selectDistinct({ id: newsClassifications.articleId })
        .from(newsClassifications)
        .where(inArray(newsClassifications.articleId, keys.map(repOf)))
    ).map((r) => r.id),
  );
  const chosen = new Set<number>();
  const pending = new Set<number>();
  const perCompany = new Map<number, Set<number>>();
  for (const r of rows) {
    const id = repOf(r.clusterId ?? r.articleId);
    if (done.has(id)) continue;
    pending.add(id);
    const taken = perCompany.get(r.companyId) ?? new Set<number>();
    perCompany.set(r.companyId, taken);
    if (taken.size >= perHolding || taken.has(id)) continue;
    taken.add(id);
    chosen.add(id);
  }
  return { ids: [...chosen], left: pending.size - chosen.size };
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
  opts: { now?: Date; limiter?: Limiter } = {},
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
    unclassified: 0,
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
    const heldIds = [...byTicker.values()];
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
      const picked = await pickForClassification(db, inserted, heldIds, CLASSIFY_PER_HOLDING);
      result.unclassified = picked.left;
      await inPool(picked.ids, CLASSIFY_CONCURRENCY, async (id) => {
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

/**
 * Classifies one story on request, for a story the scan left unclassified. The story must be about this
 * portfolio (checked by loading its analysis first); counts against its own hourly allowance. Returns the
 * refreshed analysis.
 */
export async function classifyNewsStory(
  db: Db,
  sessionId: string,
  portfolioId: string,
  articleId: number,
  classifier: Classifier | null,
  opts: { now?: Date; limiter?: Limiter } = {},
): Promise<NewsAnalysis> {
  const before = await getNewsAnalysis(db, sessionId, portfolioId, articleId, { now: opts.now });
  if (before.classifications.length) return before;
  if (!classifier) throw new AppError("unavailable", "No classifier is configured on this server");
  const limiter =
    opts.limiter ?? new RateLimiter(db, CLASSIFY_ONE_LIMIT.max, CLASSIFY_ONE_LIMIT.windowMs);
  if (!(await limiter.tryAcquire(`news-classify:${sessionId}`)))
    throw new AppError(
      "rate_limited",
      `Classifying single stories is limited to ${CLASSIFY_ONE_LIMIT.max} an hour.`,
    );
  await seedEventTypes(db);
  const r = await classifyAndStore(db, classifier, articleId);
  if (r.status !== "ok") throw new AppError("unavailable", "The classifier could not classify it");
  return getNewsAnalysis(db, sessionId, portfolioId, articleId, { now: opts.now });
}

function chunk<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
