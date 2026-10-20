import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { MIN_LINK_SCORE } from "@portfolio-lab/data";
import {
  companies,
  holdings,
  newsArticles,
  newsCompanyLinks,
  portfolios,
  type Db,
} from "@portfolio-lab/db";
import { scoreRelevance, type NewsClass, type RelevanceResult } from "@portfolio-lab/finance";
import { AppError } from "./errors";
import {
  latestClassifications,
  mergeClusters,
  type ClassificationInfo,
  type LinkRow,
} from "./news-links";

/** Items scoring below this are collapsed on screen, not hidden. */
export const LOW_RELEVANCE_THRESHOLD = 1;
export const RADAR_MAX_ITEMS = 200;
export const CLASS_FILTERS = [
  "fundamental",
  "narrative",
  "noise",
  "unclear",
  "unclassified",
] as const;
export type ClassFilter = (typeof CLASS_FILTERS)[number];

export interface RadarItem {
  title: string;
  url: string;
  source: string | null;
  publishedAt: string;
  session: string | null;
  ageDays: number;
  copies: number;
  relevance: RelevanceResult;
  classification: ClassificationInfo | null;
}

export interface Radar {
  portfolio: { id: string; name: string };
  days: number;
  /** The portfolio's tickers, for the holding filter. */
  holdings: string[];
  threshold: number;
  items: RadarItem[];
  counts: { total: number; shown: number; collapsed: number; byClass: Record<string, number> };
}

/**
 * News from the last `days` days that touches this portfolio, ranked by how much this investor should care.
 * Fresh, economically important news about large holdings ranks first; everything is kept, with low scores collapsed.
 */
export async function getMarketRadar(
  db: Db,
  sessionId: string,
  portfolioId: string,
  opts: { days?: number; now?: Date; class?: ClassFilter; ticker?: string } = {},
): Promise<Radar> {
  const { days = 7, now = new Date() } = opts;
  const [p] = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.sessionId, sessionId)));
  if (!p) throw new AppError("not_found", "Portfolio not found");

  const hs = await db
    .select({ companyId: companies.id, ticker: companies.ticker, weight: holdings.weight })
    .from(holdings)
    .innerJoin(companies, eq(companies.id, holdings.companyId))
    .where(eq(holdings.portfolioId, portfolioId))
    .orderBy(asc(companies.ticker));
  const byId = new Map(hs.map((h) => [h.companyId, h]));

  const from = new Date(now.getTime() - days * 86_400_000);
  const rows: LinkRow[] = hs.length
    ? await db
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
        })
        .from(newsCompanyLinks)
        .innerJoin(newsArticles, eq(newsArticles.id, newsCompanyLinks.articleId))
        .where(
          and(
            inArray(newsCompanyLinks.companyId, [...byId.keys()]),
            gte(newsCompanyLinks.score, MIN_LINK_SCORE),
            gte(newsArticles.publishedAt, from),
            lte(newsArticles.publishedAt, now),
          ),
        )
    : [];

  const merged = mergeClusters(rows);
  const classes = await latestClassifications(
    db,
    merged.map((m) => m.earliest.id),
  );

  let items: RadarItem[] = merged.map(({ earliest, copies, perCompany }) => {
    const c = classes.get(earliest.id) ?? null;
    const ageDays = Math.max(0, (now.getTime() - earliest.publishedAt.getTime()) / 86_400_000);
    const relevance = scoreRelevance({
      links: [...perCompany.entries()].map(([companyId, linkScore]) => ({
        ticker: byId.get(companyId)!.ticker,
        linkScore,
        weight: byId.get(companyId)!.weight,
      })),
      classification: c
        ? { class: c.class as NewsClass, fundamentalImportance: c.fundamentalImportance }
        : null,
      ageDays,
    });
    return {
      title: earliest.title,
      url: earliest.url,
      source: earliest.source,
      publishedAt: earliest.publishedAt.toISOString(),
      session: earliest.session,
      ageDays,
      copies,
      relevance,
      classification: c,
    };
  });

  if (opts.class)
    items = items.filter((i) =>
      opts.class === "unclassified"
        ? i.classification === null
        : i.classification?.class === opts.class,
    );
  if (opts.ticker)
    items = items.filter((i) => i.relevance.matched.some((m) => m.ticker === opts.ticker));
  items.sort(
    (a, b) =>
      b.relevance.score - a.relevance.score ||
      b.publishedAt.localeCompare(a.publishedAt) ||
      a.title.localeCompare(b.title),
  );

  const total = items.length;
  const shown = items.filter((i) => i.relevance.score >= LOW_RELEVANCE_THRESHOLD).length;
  const byClass: Record<string, number> = {};
  for (const i of items)
    byClass[i.classification?.class ?? "unclassified"] =
      (byClass[i.classification?.class ?? "unclassified"] ?? 0) + 1;

  return {
    portfolio: { id: p.id, name: p.name },
    days,
    holdings: hs.map((h) => h.ticker),
    threshold: LOW_RELEVANCE_THRESHOLD,
    items: items.slice(0, RADAR_MAX_ITEMS),
    counts: { total, shown, collapsed: total - shown, byClass },
  };
}
