import { desc, eq, inArray } from "drizzle-orm";
import { eventTypes, newsClassifications, type Db } from "@portfolio-lab/db";

export interface LinkRow {
  id: number;
  title: string;
  url: string;
  source: string | null;
  publishedAt: Date;
  session: string | null;
  clusterId: number | null;
  companyId: number;
  score: number;
}

export interface MergedArticle {
  earliest: LinkRow;
  /** Other articles merged into this one as near-duplicates. */
  copies: number;
  /** Best link score per company, taken from the earliest article. */
  perCompany: Map<number, number>;
  /** Every outlet in the group, earliest first. */
  outlets: string[];
}

/** One entry per near-duplicate group: its earliest article, so a syndicated story appears once. */
export function mergeClusters(rows: readonly LinkRow[]): MergedArticle[] {
  const groups = new Map<number, LinkRow[]>();
  for (const r of rows) {
    const key = r.clusterId ?? r.id;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].map((members) => {
    const earliest = members.reduce((a, b) => (b.publishedAt < a.publishedAt ? b : a));
    const perCompany = new Map<number, number>();
    for (const m of members.filter((m) => m.id === earliest.id)) {
      perCompany.set(m.companyId, Math.max(perCompany.get(m.companyId) ?? 0, m.score));
    }
    const outlets = [
      ...new Set(
        [...members]
          .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())
          .map((m) => m.source)
          .filter((x): x is string => !!x),
      ),
    ];
    return { earliest, copies: new Set(members.map((m) => m.id)).size - 1, perCompany, outlets };
  });
}

export interface ClassificationInfo {
  class: string;
  eventType: string | null;
  fundamentalImportance: number;
  marketRelevance: number;
  expectedPersistence: number;
  mechanism: string;
}

/** The most recent classification of each article, whichever model or prompt version produced it. */
export async function latestClassifications(
  db: Db,
  articleIds: readonly number[],
): Promise<Map<number, ClassificationInfo>> {
  if (articleIds.length === 0) return new Map();
  const rows = await db
    .select({
      articleId: newsClassifications.articleId,
      class: newsClassifications.class,
      eventType: eventTypes.slug,
      fundamentalImportance: newsClassifications.fundamentalImportance,
      marketRelevance: newsClassifications.marketRelevance,
      expectedPersistence: newsClassifications.expectedPersistence,
      mechanism: newsClassifications.mechanism,
    })
    .from(newsClassifications)
    .leftJoin(eventTypes, eq(eventTypes.id, newsClassifications.eventTypeId))
    .where(inArray(newsClassifications.articleId, [...articleIds]))
    .orderBy(desc(newsClassifications.createdAt));
  const latest = new Map<number, ClassificationInfo>();
  for (const { articleId, ...info } of rows)
    if (!latest.has(articleId)) latest.set(articleId, info);
  return latest;
}

/** Coverage counts for the News overview: stories per holding, by type, and the outlets behind them. */
export function newsOverview(
  items: readonly {
    source: string | null;
    sources?: number;
    classification: { class: string } | null;
    relevance: { matched: { ticker: string }[] };
  }[],
) {
  const byHolding = new Map<string, number>();
  const byClass = new Map<string, number>();
  const byOutlet = new Map<string, number>();
  for (const i of items) {
    for (const m of i.relevance.matched)
      byHolding.set(m.ticker, (byHolding.get(m.ticker) ?? 0) + 1);
    const c = i.classification?.class ?? "unclassified";
    byClass.set(c, (byClass.get(c) ?? 0) + 1);
    const o = i.source ?? "unknown";
    byOutlet.set(o, (byOutlet.get(o) ?? 0) + 1);
  }
  const sorted = (m: Map<string, number>) =>
    [...m.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return { byHolding: sorted(byHolding), byClass: sorted(byClass), byOutlet: sorted(byOutlet) };
}
