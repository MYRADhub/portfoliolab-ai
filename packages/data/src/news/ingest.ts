import { and, eq, gte, inArray, lte } from "drizzle-orm";
import {
  companies,
  ingestFailures,
  newsArticles,
  newsCompanyLinks,
  type Db,
} from "@portfolio-lab/db";
import { ProviderError } from "../providers/types";
import { canonicalUrl, jaccard, NEAR_DUPLICATE_THRESHOLD, shingles, titleHash } from "./normalize";
import { marketSession } from "./session";
import type { NewsProvider, RawArticle } from "./types";

const CLUSTER_WINDOW_MS = 48 * 3_600_000;

export interface NewsIngestSummary {
  fetched: number;
  inserted: number;
  duplicates: number;
  clustered: number;
  links: number;
  failures: { ticker: string; error: string }[];
  stoppedEarly: "rate_limited" | null;
  remaining: string[];
}

/** Earliest article in the near-duplicate group a new article belongs to, or null if it starts a new group. */
async function findCluster(
  db: Db,
  article: { title: string; hash: string; publishedAt: Date },
): Promise<number | null> {
  const lo = new Date(article.publishedAt.getTime() - CLUSTER_WINDOW_MS);
  const hi = new Date(article.publishedAt.getTime() + CLUSTER_WINDOW_MS);
  const rows = await db
    .select({
      id: newsArticles.id,
      title: newsArticles.title,
      hash: newsArticles.dedupeHash,
      clusterId: newsArticles.clusterId,
    })
    .from(newsArticles)
    .where(and(gte(newsArticles.publishedAt, lo), lte(newsArticles.publishedAt, hi)));
  const mine = shingles(article.title);
  const ids: number[] = [];
  for (const r of rows) {
    if (r.hash === article.hash || jaccard(mine, shingles(r.title)) >= NEAR_DUPLICATE_THRESHOLD) {
      ids.push(r.clusterId ?? r.id);
    }
  }
  return ids.length ? Math.min(...ids) : null;
}

async function storeArticle(
  db: Db,
  provider: string,
  queriedTicker: string,
  a: RawArticle,
): Promise<{ inserted: boolean; clustered: boolean; links: number }> {
  const hash = titleHash(a.title);
  const [row] = await db
    .insert(newsArticles)
    .values({
      provider,
      providerId: a.providerId,
      url: canonicalUrl(a.url),
      title: a.title,
      snippet: a.snippet ?? null,
      body: a.body ?? null,
      sourceName: a.sourceName ?? null,
      publishedAt: a.publishedAt,
      dedupeHash: hash,
      marketSession: marketSession(a.publishedAt),
    })
    .onConflictDoNothing()
    .returning({ id: newsArticles.id });

  let id: number;
  let clustered = false;
  if (row) {
    id = row.id;
    const cluster = await findCluster(db, {
      title: a.title,
      hash,
      publishedAt: a.publishedAt,
    }).then((c) =>
      // The query above also matches the row just inserted; ignore a self-match.
      c === id ? null : c,
    );
    await db
      .update(newsArticles)
      .set({ clusterId: cluster ?? id })
      .where(eq(newsArticles.id, id));
    clustered = cluster !== null;
  } else {
    const [existing] = await db
      .select({ id: newsArticles.id })
      .from(newsArticles)
      .where(and(eq(newsArticles.provider, provider), eq(newsArticles.providerId, a.providerId)));
    if (!existing) throw new Error(`article ${a.providerId} neither inserted nor found`);
    id = existing.id;
  }

  const tags = [...new Set([queriedTicker, ...a.tickers])];
  const known = await db
    .select({ id: companies.id })
    .from(companies)
    .where(inArray(companies.ticker, tags));
  let links = 0;
  if (known.length) {
    const inserted = await db
      .insert(newsCompanyLinks)
      .values(
        known.map((c) => ({ articleId: id, companyId: c.id, method: "provider_tag", score: 1 })),
      )
      .onConflictDoNothing()
      .returning({ a: newsCompanyLinks.articleId });
    links = inserted.length;
  }
  return { inserted: row !== undefined, clustered, links };
}

/**
 * Pulls news for each ticker and stores it idempotently. A failure on one ticker is written to the dead-letter
 * table and skipped; a rate-limit error stops the run and reports the tickers not yet processed.
 */
export async function ingestNews(
  db: Db,
  provider: NewsProvider,
  tickers: readonly string[],
  range: { from: string; to: string },
  opts: { delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<NewsIngestSummary> {
  const { delayMs = 0, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = opts;
  const summary: NewsIngestSummary = {
    fetched: 0,
    inserted: 0,
    duplicates: 0,
    clustered: 0,
    links: 0,
    failures: [],
    stoppedEarly: null,
    remaining: [],
  };

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i]!;
    try {
      const articles = await provider.getCompanyNews(ticker, range.from, range.to);
      summary.fetched += articles.length;
      for (const a of articles) {
        try {
          const r = await storeArticle(db, provider.name, ticker, a);
          if (r.inserted) summary.inserted++;
          else summary.duplicates++;
          if (r.clustered) summary.clustered++;
          summary.links += r.links;
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          summary.failures.push({ ticker, error });
          await db.insert(ingestFailures).values({
            provider: provider.name,
            subject: `${ticker}:${a.providerId}`,
            error,
            payload: { title: a.title, url: a.url },
          });
        }
      }
    } catch (err) {
      if (err instanceof ProviderError && err.kind === "rate_limited") {
        summary.stoppedEarly = "rate_limited";
        summary.remaining = tickers.slice(i);
        return summary;
      }
      const error = err instanceof Error ? err.message : String(err);
      summary.failures.push({ ticker, error });
      await db.insert(ingestFailures).values({ provider: provider.name, subject: ticker, error });
    }
    if (delayMs > 0 && i < tickers.length - 1) await sleep(delayMs);
  }
  return summary;
}
