import { and, eq, isNotNull } from "drizzle-orm";
import {
  companies,
  eventTypes,
  fundamentals,
  newsArticles,
  newsClassifications,
  newsCompanyLinks,
  type Db,
} from "@portfolio-lab/db";
import { titleHash } from "../news/normalize";
import { marketSession } from "../news/session";
import { ProviderError } from "../providers/types";
import type { EdgarClient } from "./edgar";
import { extractAnnual } from "./fundamentals";
import { filingUrl, parseEightKs } from "./filings";
import { eventForItems, ITEM_RULES } from "./items";

export const SEC_PROVIDER = "sec";
export const SEC_MODEL = "sec-rules";
export const SEC_PROMPT_VERSION = "items-v1";

/** The only event type we need that the language-model taxonomy does not have: a neutral earnings release. */
async function ensureEarningsReleaseType(db: Db) {
  await db
    .insert(eventTypes)
    .values({
      slug: "earnings_release",
      name: "Earnings release",
      defaultClass: "fundamental",
      definition:
        "Company reports quarterly or annual results (SEC Form 8-K item 2.02). Direction unknown until compared with expectations.",
    })
    .onConflictDoNothing({ target: eventTypes.slug });
}

export interface SecSummary {
  companies: number;
  articles: number;
  skipped: number;
  failed: { ticker: string; error: string }[];
}

export interface EightKSummary extends SecSummary {
  /** Filings with a mapped item whose event type is not in the database, by slug. They are not stored. */
  missingType: Record<string, number>;
}

async function companiesWithCik(db: Db, tickers?: readonly string[]) {
  const rows = await db
    .select({
      id: companies.id,
      ticker: companies.ticker,
      name: companies.name,
      cik: companies.cik,
    })
    .from(companies)
    .where(and(isNotNull(companies.cik)));
  const wanted = tickers ? new Set(tickers) : null;
  return rows.filter((r) => !wanted || wanted.has(r.ticker));
}

/**
 * Loads Form 8-K filings as classified events. The class and importance come from the filing's item numbers by
 * fixed rules (see items.ts), not from a language model, and the filing's acceptance time is the event time.
 */
export async function ingestEightKs(
  db: Db,
  edgar: EdgarClient,
  opts: {
    since: string;
    tickers?: readonly string[];
    limit?: number;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<EightKSummary> {
  const { delayMs = 120, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } =
    opts;
  await ensureEarningsReleaseType(db);
  const types = new Map((await db.select().from(eventTypes)).map((t) => [t.slug, t]));
  const list = (await companiesWithCik(db, opts.tickers)).slice(0, opts.limit ?? Infinity);
  const summary: EightKSummary = {
    companies: 0,
    articles: 0,
    skipped: 0,
    missingType: {},
    failed: [],
  };

  for (const c of list) {
    try {
      const filings = parseEightKs(await edgar.submissions(c.cik!), opts.since);
      for (const f of filings) {
        const event = eventForItems(f.items);
        if (!event) {
          summary.skipped++;
          continue;
        }
        const type = types.get(event.slug);
        if (!type) {
          summary.missingType[event.slug] = (summary.missingType[event.slug] ?? 0) + 1;
          continue;
        }
        const title = `${c.name} files 8-K: ${ITEM_RULES[event.primaryItem]!.description} (Item ${event.primaryItem})`;
        const [article] = await db
          .insert(newsArticles)
          .values({
            provider: SEC_PROVIDER,
            providerId: `${f.accession}:${c.ticker}`,
            url: filingUrl(c.cik!, f),
            title,
            sourceName: "SEC EDGAR",
            publishedAt: f.acceptedAt,
            dedupeHash: titleHash(`${title} ${f.accession}`),
            marketSession: marketSession(f.acceptedAt),
          })
          .onConflictDoNothing()
          .returning({ id: newsArticles.id });
        if (!article) continue; // already loaded
        await db
          .update(newsArticles)
          .set({ clusterId: article.id })
          .where(eq(newsArticles.id, article.id));
        await db
          .insert(newsCompanyLinks)
          .values({ articleId: article.id, companyId: c.id, method: "sec", score: 1 });
        await db.insert(newsClassifications).values({
          articleId: article.id,
          eventTypeId: type.id,
          class: type.defaultClass,
          fundamentalImportance: event.importance,
          marketRelevance: event.importance,
          expectedPersistence:
            type.defaultClass === "fundamental" ? Math.max(3, event.importance - 1) : 2,
          mechanism: `SEC Form 8-K. ${event.descriptions.join("; ")}.`,
          confidence: 1,
          model: SEC_MODEL,
          promptVersion: SEC_PROMPT_VERSION,
          contentHash: f.accession,
        });
        summary.articles++;
      }
      summary.companies++;
    } catch (err) {
      summary.failed.push({
        ticker: c.ticker,
        error: err instanceof Error ? err.message : String(err),
      });
      if (err instanceof ProviderError && err.kind === "rate_limited") break;
    }
    if (delayMs > 0) await sleep(delayMs);
  }
  return summary;
}

/** Loads annual fundamentals from EDGAR company facts. Existing (company, metric, year) rows are updated. */
export async function ingestFundamentals(
  db: Db,
  edgar: EdgarClient,
  opts: {
    tickers?: readonly string[];
    limit?: number;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<SecSummary> {
  const { delayMs = 120, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } =
    opts;
  const list = (await companiesWithCik(db, opts.tickers)).slice(0, opts.limit ?? Infinity);
  const summary: SecSummary = { companies: 0, articles: 0, skipped: 0, failed: [] };
  for (const c of list) {
    try {
      const figures = extractAnnual(await edgar.companyFacts(c.cik!));
      for (const f of figures)
        await db
          .insert(fundamentals)
          .values({ companyId: c.id, ...f })
          .onConflictDoUpdate({
            target: [fundamentals.companyId, fundamentals.metric, fundamentals.fiscalYear],
            set: {
              periodEnd: f.periodEnd,
              value: f.value,
              filedAt: f.filedAt,
              accession: f.accession,
            },
          });
      if (figures.length === 0) summary.skipped++;
      summary.companies++;
    } catch (err) {
      summary.failed.push({
        ticker: c.ticker,
        error: err instanceof Error ? err.message : String(err),
      });
      if (err instanceof ProviderError && err.kind === "rate_limited") break;
    }
    if (delayMs > 0) await sleep(delayMs);
  }
  return summary;
}
