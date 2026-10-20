import { and, eq, inArray } from "drizzle-orm";
import {
  companies,
  companyFactorExposures,
  eventTypes,
  factors,
  newsArticles,
  newsClassifications,
  newsCompanyLinks,
  type Db,
} from "@portfolio-lab/db";
import { seedEventTypes } from "@portfolio-lab/classify";
import { FixtureProvider, ingestPrices, marketSession, titleHash } from "@portfolio-lab/data";
import { DEMO_EXPOSURES, DEMO_FACTORS, DEMO_NEWS, DEMO_TICKERS } from "./data";

export interface DemoSeedSummary {
  pricedTickers: number;
  factors: number;
  exposures: number;
  articles: number;
}

/** Loads fixture prices for the demo companies only. Idempotent; resumes from the last stored day. */
export async function seedDemoPrices(
  db: Db,
  opts: { now?: Date; years?: number } = {},
): Promise<void> {
  const { now = new Date(), years = 3 } = opts;
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - years * 365 * 86_400_000).toISOString().slice(0, 10);
  const provider = new FixtureProvider();
  for (const t of DEMO_TICKERS) await ingestPrices(db, provider, t, { backfillFrom: from, to });
}

/**
 * Fills a database that already has migrations and the S&P 500 companies with demo prices, factors, exposures and
 * news. Safe to run again: existing rows are left alone and news is only added when none of the demo news exists.
 */
export async function seedDemoData(
  db: Db,
  opts: { now?: Date; years?: number } = {},
): Promise<DemoSeedSummary> {
  const { now = new Date() } = opts;
  await seedDemoPrices(db, opts);

  await db.insert(factors).values(DEMO_FACTORS).onConflictDoNothing({ target: factors.slug });
  const factorRows = await db
    .select()
    .from(factors)
    .where(
      inArray(
        factors.slug,
        DEMO_FACTORS.map((f) => f.slug),
      ),
    );
  const factorId = new Map(factorRows.map((f) => [f.slug, f.id]));
  const companyRows = await db
    .select({ id: companies.id, ticker: companies.ticker })
    .from(companies)
    .where(inArray(companies.ticker, [...DEMO_TICKERS]));
  const companyId = new Map(companyRows.map((c) => [c.ticker, c.id]));
  const missing = DEMO_TICKERS.filter((t) => !companyId.has(t));
  if (missing.length)
    throw new Error(`companies not loaded: ${missing.join(", ")}; load the S&P 500 first`);

  let exposures = 0;
  const haveExposure = await db
    .select({ id: companyFactorExposures.id })
    .from(companyFactorExposures)
    .where(inArray(companyFactorExposures.companyId, [...companyId.values()]))
    .limit(1);
  if (haveExposure.length === 0) {
    const rows = DEMO_EXPOSURES.map(([ticker, slug, magnitude, direction, confidence]) => ({
      companyId: companyId.get(ticker)!,
      factorId: factorId.get(slug)!,
      magnitude,
      direction,
      confidence,
      rationale: "Demo data: illustrative only, not reviewed.",
      source: "manual" as const,
    }));
    exposures = (
      await db
        .insert(companyFactorExposures)
        .values(rows)
        .returning({ id: companyFactorExposures.id })
    ).length;
  }

  await seedEventTypes(db);
  const typeId = new Map(
    (await db.select({ id: eventTypes.id, slug: eventTypes.slug }).from(eventTypes)).map((e) => [
      e.slug,
      e.id,
    ]),
  );

  let articles = 0;
  const already = await db
    .select({ id: newsArticles.id })
    .from(newsArticles)
    .where(eq(newsArticles.provider, "demo"))
    .limit(1);
  if (already.length === 0) {
    for (const [i, item] of DEMO_NEWS.entries()) {
      const publishedAt = new Date(now.getTime() - item.hoursAgo * 3_600_000);
      const insert = async (title: string, at: Date, clusterOf?: number) => {
        const [a] = await db
          .insert(newsArticles)
          .values({
            provider: "demo",
            providerId: `${i}:${title}`,
            url: `https://demo.invalid/news/${i}/${encodeURIComponent(title)}`,
            title,
            sourceName: "Demo Wire",
            publishedAt: at,
            dedupeHash: titleHash(title),
            marketSession: marketSession(at),
          })
          .returning({ id: newsArticles.id });
        await db
          .update(newsArticles)
          .set({ clusterId: clusterOf ?? a!.id })
          .where(eq(newsArticles.id, a!.id));
        await db.insert(newsCompanyLinks).values(
          item.tickers.map((t, k) => ({
            articleId: a!.id,
            companyId: companyId.get(t)!,
            method: "alias",
            score: k === 0 ? 0.9 : 0.85,
          })),
        );
        articles++;
        return a!.id;
      };
      const id = await insert(item.title, publishedAt);
      if (item.copyTitle)
        await insert(item.copyTitle, new Date(publishedAt.getTime() + 45 * 60_000), id);
      await db.insert(newsClassifications).values({
        articleId: id,
        eventTypeId: typeId.get(item.eventType) ?? null,
        class: item.cls,
        fundamentalImportance: item.importance,
        marketRelevance: Math.min(10, item.importance + 1),
        expectedPersistence: item.cls === "fundamental" ? Math.max(3, item.importance - 1) : 2,
        mechanism: "Demo data: illustrative classification, not produced by the model.",
        confidence: 0.8,
        model: "demo",
        promptVersion: "demo",
        contentHash: `demo-${i}`,
      });
    }
  }
  const priced = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(inArray(companies.ticker, [...DEMO_TICKERS])));
  return { pricedTickers: priced.length, factors: factorRows.length, exposures, articles };
}
