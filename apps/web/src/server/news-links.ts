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
    return { earliest, copies: new Set(members.map((m) => m.id)).size - 1, perCompany };
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
