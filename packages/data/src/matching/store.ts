import { and, eq, inArray, notExists, sql } from "drizzle-orm";
import {
  companies,
  companyAliases,
  newsArticles,
  newsCompanyLinks,
  type Db,
} from "@portfolio-lab/db";
import { generateAliases } from "./alias";
import { AliasIndex } from "./matcher";

/** Regenerates name aliases for every company. Idempotent; keeps hand-added aliases of other kinds. */
export async function syncAliases(db: Db): Promise<number> {
  const rows = await db.select({ id: companies.id, name: companies.name }).from(companies);
  const values = rows.flatMap((c) =>
    generateAliases(c.name).map((a) => ({
      companyId: c.id,
      alias: a.alias,
      kind: a.kind,
      ambiguous: a.ambiguous,
    })),
  );
  let n = 0;
  for (let i = 0; i < values.length; i += 500) {
    const res = await db
      .insert(companyAliases)
      .values(values.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [companyAliases.companyId, companyAliases.alias],
        set: { ambiguous: sql`excluded.ambiguous` },
      })
      .returning({ id: companyAliases.id });
    n += res.length;
  }
  return n;
}

export async function loadAliasIndex(db: Db): Promise<AliasIndex> {
  const [aliases, tickers] = await Promise.all([
    db
      .select({
        companyId: companyAliases.companyId,
        alias: companyAliases.alias,
        ambiguous: companyAliases.ambiguous,
      })
      .from(companyAliases),
    db.select({ companyId: companies.id, ticker: companies.ticker }).from(companies),
  ]);
  return new AliasIndex(aliases, tickers);
}

/**
 * Writes alias-method links for the given articles (or every article without any alias link when omitted).
 * Replaces that article's previous alias links so improved matching can be re-run. Returns links written.
 */
export async function matchArticles(
  db: Db,
  index: AliasIndex,
  articleIds?: readonly number[],
): Promise<number> {
  const articles = await db
    .select({
      id: newsArticles.id,
      title: newsArticles.title,
      snippet: newsArticles.snippet,
      body: newsArticles.body,
    })
    .from(newsArticles)
    .where(
      articleIds
        ? inArray(newsArticles.id, [...articleIds])
        : notExists(
            db
              .select({ x: sql`1` })
              .from(newsCompanyLinks)
              .where(
                and(
                  eq(newsCompanyLinks.articleId, newsArticles.id),
                  eq(newsCompanyLinks.method, "alias"),
                ),
              ),
          ),
    );

  let written = 0;
  for (const a of articles) {
    const matches = index.match({ title: a.title, snippet: a.snippet, body: a.body });
    await db
      .delete(newsCompanyLinks)
      .where(and(eq(newsCompanyLinks.articleId, a.id), eq(newsCompanyLinks.method, "alias")));
    if (matches.length === 0) continue;
    await db.insert(newsCompanyLinks).values(
      matches.map((m) => ({
        articleId: a.id,
        companyId: m.companyId,
        method: "alias",
        score: m.score,
      })),
    );
    written += matches.length;
  }
  return written;
}
