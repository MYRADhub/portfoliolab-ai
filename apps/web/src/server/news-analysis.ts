import { and, asc, desc, eq, gte, lte, or } from "drizzle-orm";
import { eventTradingDate, loadAliasIndex, MIN_LINK_SCORE } from "@portfolio-lab/data";
import {
  benchmarkPrices,
  companies,
  eventTypes,
  holdings,
  newsArticles,
  newsClassifications,
  newsCompanyLinks,
  portfolios,
  pricesDaily,
  type Db,
} from "@portfolio-lab/db";
import {
  CLASS_IMPACT_CAP,
  HALF_LIFE_DAYS,
  impactOf,
  MIN_WEIGHT_FACTOR,
  recencyOf,
  scoreRelevance,
  UNCLASSIFIED_IMPACT,
  WEIGHT_FULL_AT,
  weightFactor,
  type NewsClass,
  type RelevanceResult,
} from "@portfolio-lab/finance";
import { AppError } from "./errors";
import { LOW_RELEVANCE_THRESHOLD } from "./radar";

export interface CoverageItem {
  id: number;
  title: string;
  url: string;
  source: string | null;
  provider: string;
  publishedAt: string;
}

export interface LinkExplanation {
  ticker: string;
  name: string;
  method: string;
  score: number;
  /** Plain-English reason for the link. */
  why: string;
  /** The words found in the story, for name matches. */
  evidence: string[];
  /** Share of the portfolio, or null when the company is not held. */
  weight: number | null;
  /** True when the link is too weak to count (below the minimum score). */
  ignored: boolean;
}

export interface ClassificationRecord {
  class: string;
  eventType: { slug: string; name: string; definition: string } | null;
  fundamentalImportance: number;
  marketRelevance: number;
  expectedPersistence: number;
  mechanism: string;
  confidence: number;
  model: string;
  promptVersion: string;
  /** "rules" for fixed mappings (SEC item numbers), "ai" for a language model. */
  decidedBy: "rules" | "ai";
  createdAt: string;
}

export interface Reaction {
  ticker: string;
  /** The first trading day whose price could reflect the story. */
  tradingDate: string;
  stockDay: number | null;
  marketDay: number | null;
  /** Stock minus market, the same day. */
  excessDay: number | null;
  /** Stock and market over that day and the next. */
  stockTwoDay: number | null;
  marketTwoDay: number | null;
  excessTwoDay: number | null;
  note: string | null;
}

export interface NewsAnalysis {
  article: CoverageItem & { snippet: string | null; session: string | null };
  coverage: CoverageItem[];
  outlets: number;
  links: LinkExplanation[];
  classifications: ClassificationRecord[];
  relevance: RelevanceResult & {
    steps: { label: string; value: string; detail: string }[];
    threshold: number;
    shown: boolean;
    rules: {
      weightFullAt: number;
      minWeightFactor: number;
      halfLifeDays: number;
      unclassifiedImpact: number;
      classCaps: Record<NewsClass, number>;
    };
  };
  reactions: Reaction[];
}

const METHOD_WHY: Record<string, string> = {
  provider_tag: "The news feed tagged the story with this company.",
  alias: "The company's name or ticker appears in the story.",
  llm: "A language model judged the story to be about this company.",
  exposure: "The story is about a force this company is exposed to.",
  web_search:
    "Found by a web search for this company, but its name was not matched in the text we have, so the link is weak.",
};

const pctTxt = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

function article(r: typeof newsArticles.$inferSelect): CoverageItem {
  return {
    id: r.id,
    title: r.title,
    url: r.url,
    source: r.sourceName,
    provider: r.provider,
    publishedAt: r.publishedAt.toISOString(),
  };
}

/** Closes from a few days before `date` to a few after, for one company or SPY. */
async function closesAround(db: Db, companyId: number | "SPY", date: string) {
  const lo = new Date(Date.parse(date) - 10 * 86_400_000).toISOString().slice(0, 10);
  const hi = new Date(Date.parse(date) + 10 * 86_400_000).toISOString().slice(0, 10);
  if (companyId === "SPY")
    return db
      .select({ date: benchmarkPrices.date, close: benchmarkPrices.adjClose })
      .from(benchmarkPrices)
      .where(
        and(
          eq(benchmarkPrices.symbol, "SPY"),
          gte(benchmarkPrices.date, lo),
          lte(benchmarkPrices.date, hi),
        ),
      )
      .orderBy(asc(benchmarkPrices.date));
  return db
    .select({ date: pricesDaily.date, close: pricesDaily.adjClose })
    .from(pricesDaily)
    .where(
      and(
        eq(pricesDaily.companyId, companyId),
        gte(pricesDaily.date, lo),
        lte(pricesDaily.date, hi),
      ),
    )
    .orderBy(asc(pricesDaily.date));
}

/** Return on the event day and over the event day plus the next, from closes; null where prices are missing. */
export function eventReturns(rows: readonly { date: string; close: number }[], t0: string) {
  const i = rows.findIndex((r) => r.date >= t0);
  if (i <= 0) return { day: null, twoDay: null, date: i === 0 ? rows[0]!.date : null };
  const prev = rows[i - 1]!.close;
  const day = rows[i]!.close / prev - 1;
  const twoDay = rows[i + 1] ? rows[i + 1]!.close / prev - 1 : null;
  return { day, twoDay, date: rows[i]!.date };
}

/**
 * Everything behind one story's place in the portfolio's news: who covered it, why it is linked to which company,
 * how it was classified and by what, the relevance arithmetic with this portfolio's numbers, and how the stock
 * actually moved compared with the market.
 */
export async function getNewsAnalysis(
  db: Db,
  sessionId: string,
  portfolioId: string,
  articleId: number,
  opts: { now?: Date } = {},
): Promise<NewsAnalysis> {
  const now = opts.now ?? new Date();
  const [p] = await db
    .select({ id: portfolios.id })
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.sessionId, sessionId)));
  if (!p) throw new AppError("not_found", "Portfolio not found");
  const [a] = await db.select().from(newsArticles).where(eq(newsArticles.id, articleId));
  if (!a) throw new AppError("not_found", "Story not found");

  const clusterKey = a.clusterId ?? a.id;
  const coverageRows = await db
    .select()
    .from(newsArticles)
    .where(or(eq(newsArticles.clusterId, clusterKey), eq(newsArticles.id, clusterKey)))
    .orderBy(asc(newsArticles.publishedAt), asc(newsArticles.id));
  const coverage = coverageRows.map(article);
  const earliest = coverageRows[0] ?? a;

  const held = new Map(
    (
      await db
        .select({ companyId: holdings.companyId, weight: holdings.weight })
        .from(holdings)
        .where(eq(holdings.portfolioId, portfolioId))
    ).map((h) => [h.companyId, h.weight]),
  );
  const linkRows = await db
    .select({
      companyId: newsCompanyLinks.companyId,
      method: newsCompanyLinks.method,
      score: newsCompanyLinks.score,
      ticker: companies.ticker,
      name: companies.name,
    })
    .from(newsCompanyLinks)
    .innerJoin(companies, eq(companies.id, newsCompanyLinks.companyId))
    .where(eq(newsCompanyLinks.articleId, earliest.id))
    .orderBy(desc(newsCompanyLinks.score), asc(companies.ticker));
  const evidence = new Map<number, string[]>();
  if (linkRows.some((l) => l.method === "alias")) {
    const index = await loadAliasIndex(db);
    for (const m of index.match({
      title: earliest.title,
      snippet: earliest.snippet,
      body: earliest.body,
    }))
      evidence.set(m.companyId, m.evidence);
  }
  const links: LinkExplanation[] = linkRows.map((l) => ({
    ticker: l.ticker,
    name: l.name,
    method: l.method,
    score: l.score,
    why: METHOD_WHY[l.method] ?? `Linked by ${l.method}.`,
    evidence: l.method === "alias" ? (evidence.get(l.companyId) ?? []) : [],
    weight: held.get(l.companyId) ?? null,
    ignored: l.score < MIN_LINK_SCORE,
  }));

  const cls = await db
    .select({
      c: newsClassifications,
      slug: eventTypes.slug,
      name: eventTypes.name,
      definition: eventTypes.definition,
    })
    .from(newsClassifications)
    .leftJoin(eventTypes, eq(eventTypes.id, newsClassifications.eventTypeId))
    .where(eq(newsClassifications.articleId, earliest.id))
    .orderBy(desc(newsClassifications.createdAt));
  const classifications: ClassificationRecord[] = cls.map(({ c, slug, name, definition }) => ({
    class: c.class,
    eventType: slug ? { slug, name: name!, definition: definition! } : null,
    fundamentalImportance: c.fundamentalImportance,
    marketRelevance: c.marketRelevance,
    expectedPersistence: c.expectedPersistence,
    mechanism: c.mechanism,
    confidence: c.confidence,
    model: c.model,
    promptVersion: c.promptVersion,
    decidedBy: /rules/i.test(c.model) ? "rules" : "ai",
    createdAt: c.createdAt.toISOString(),
  }));

  // The same arithmetic the News page ranks by, with this portfolio's holdings.
  const latest = classifications[0] ?? null;
  const ageDays = Math.max(0, (now.getTime() - earliest.publishedAt.getTime()) / 86_400_000);
  const counted = linkRows.filter((l) => held.has(l.companyId) && l.score >= MIN_LINK_SCORE);
  const classification = latest
    ? { class: latest.class as NewsClass, fundamentalImportance: latest.fundamentalImportance }
    : null;
  const rel = scoreRelevance({
    links: counted.map((l) => ({
      ticker: l.ticker,
      linkScore: l.score,
      weight: held.get(l.companyId)!,
    })),
    classification,
    ageDays,
  });
  const steps = [
    ...rel.matched.map((m) => ({
      label: `${m.ticker} link`,
      value: m.contribution.toFixed(2),
      detail: `${pctTxt(m.linkScore)} sure the story is about ${m.ticker} x ${weightFactor(m.weight).toFixed(2)} for a ${pctTxt(m.weight, 1)} holding (holdings of ${pctTxt(WEIGHT_FULL_AT)} or more count fully, the smallest count ${pctTxt(MIN_WEIGHT_FACTOR)})`,
    })),
    {
      label: "Holdings touched",
      value: rel.exposureMatch.toFixed(2),
      detail: rel.matched.length
        ? "Combined so that several weak links add up but never pass 1: 1 minus the product of (1 minus each link)"
        : "The story is not linked to anything you hold",
    },
    {
      label: "Economic impact",
      value: impactOf(classification).toFixed(2),
      detail: classification
        ? `Importance ${latest!.fundamentalImportance} of 10, capped at ${CLASS_IMPACT_CAP[classification.class].toFixed(1)} for ${classification.class} news`
        : `Not classified yet, so a neutral ${UNCLASSIFIED_IMPACT}`,
    },
    {
      label: "Freshness",
      value: recencyOf(ageDays).toFixed(2),
      detail: `${ageDays.toFixed(1)} days old; half the weight is lost every ${HALF_LIFE_DAYS} days`,
    },
    {
      label: "Relevance",
      value: `${rel.score.toFixed(1)} of 10`,
      detail: "10 x holdings touched x economic impact x freshness",
    },
  ];

  const t0 = eventTradingDate(earliest.publishedAt);
  const spy = await closesAround(db, "SPY", t0);
  const mkt = eventReturns(spy, t0);
  const reactions: Reaction[] = [];
  for (const l of linkRows.filter((x) => held.has(x.companyId) && x.score >= MIN_LINK_SCORE)) {
    const s = eventReturns(await closesAround(db, l.companyId, t0), t0);
    const diff = (x: number | null, y: number | null) => (x === null || y === null ? null : x - y);
    reactions.push({
      ticker: l.ticker,
      tradingDate: s.date ?? t0,
      stockDay: s.day,
      marketDay: mkt.day,
      excessDay: diff(s.day, mkt.day),
      stockTwoDay: s.twoDay,
      marketTwoDay: mkt.twoDay,
      excessTwoDay: diff(s.twoDay, mkt.twoDay),
      note:
        s.day === null
          ? "No price yet for the first trading day after the story."
          : s.date !== t0
            ? `No price on ${t0}; the next trading day with a price is used.`
            : null,
    });
  }

  return {
    article: { ...article(earliest), snippet: earliest.snippet, session: earliest.marketSession },
    coverage,
    outlets: new Set(coverage.map((c) => c.source ?? c.provider)).size,
    links,
    classifications,
    relevance: {
      ...rel,
      steps,
      threshold: LOW_RELEVANCE_THRESHOLD,
      shown: rel.score >= LOW_RELEVANCE_THRESHOLD,
      rules: {
        weightFullAt: WEIGHT_FULL_AT,
        minWeightFactor: MIN_WEIGHT_FACTOR,
        halfLifeDays: HALF_LIFE_DAYS,
        unclassifiedImpact: UNCLASSIFIED_IMPACT,
        classCaps: CLASS_IMPACT_CAP,
      },
    },
    reactions,
  };
}
