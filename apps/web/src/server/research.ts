import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { MIN_LINK_SCORE } from "@portfolio-lab/data";
import {
  companies,
  companyFactorExposures,
  factors,
  fundamentals,
  newsArticles,
  newsCompanyLinks,
  pricesDaily,
  type Db,
} from "@portfolio-lab/db";
import {
  annualizedVolatility,
  dailyReturns,
  exposureSimilarity,
  fundamentalRatios,
  maxDrawdown,
  periodReturn,
  scoreCandidate,
  scoreRelevance,
  type CandidateScore,
  type FiscalYear,
  type FundamentalRatios,
  type NewsClass,
} from "@portfolio-lab/finance";
import { AppError } from "./errors";
import { getPortfolioExposures } from "./exposures";
import { latestClassifications, mergeClusters, type LinkRow } from "./news-links";
import { monthsAgo } from "./portfolio-data";
import type { RadarItem } from "./radar";

export const NEWS_DAYS = 90;
export const PEER_COUNT = 5;
/** Weight at which a company's own news is scored: neutral, so relevance reflects the story, not a position size. */
const NEUTRAL_WEIGHT = 0.25;

export interface CompanyResearch {
  company: { ticker: string; name: string; sector: string | null; industry: string | null };
  /** Daily adjusted closes for the last year, for the chart. */
  prices: { date: string; close: number }[];
  stats: {
    asOf: string | null;
    last: number | null;
    d1: number | null;
    m1: number | null;
    m3: number | null;
    y1: number | null;
    volatility: number | null;
    maxDrawdown: number | null;
    high52: number | null;
    low52: number | null;
  };
  exposures: {
    slug: string;
    name: string;
    category: string;
    signed: number;
    confidence: number;
    rationale: string | null;
  }[];
  /** Annual figures from SEC 10-K filings, newest first. Empty when none are loaded. */
  fundamentals: {
    years: FiscalYear[];
    periodEnd: Record<number, string>;
    ratios: FundamentalRatios | null;
  };
  peers: {
    ticker: string;
    name: string;
    sector: string | null;
    similarity: number | null;
    basis: "exposure" | "sector";
  }[];
  news: RadarItem[];
}

async function findCompany(db: Db, ticker: string) {
  const [c] = await db
    .select()
    .from(companies)
    .where(eq(companies.ticker, ticker.trim().toUpperCase()));
  if (!c) throw new AppError("not_found", "Company not found");
  return c;
}

async function exposureMap(db: Db): Promise<Map<number, Record<string, number>>> {
  const rows = await db
    .select({
      companyId: companyFactorExposures.companyId,
      slug: factors.slug,
      magnitude: companyFactorExposures.magnitude,
      direction: companyFactorExposures.direction,
    })
    .from(companyFactorExposures)
    .innerJoin(factors, eq(factors.id, companyFactorExposures.factorId))
    .where(isNull(companyFactorExposures.validTo));
  const map = new Map<number, Record<string, number>>();
  for (const r of rows) {
    const v = map.get(r.companyId) ?? {};
    v[r.slug] = r.magnitude * r.direction;
    map.set(r.companyId, v);
  }
  return map;
}

/** Public, deterministic research view of one S&P 500 company. Does not depend on any portfolio. */
export async function getCompanyResearch(
  db: Db,
  tickerInput: string,
  opts: { now?: Date } = {},
): Promise<CompanyResearch> {
  const { now = new Date() } = opts;
  const c = await findCompany(db, tickerInput);

  const rows = await db
    .select({ date: pricesDaily.date, adjClose: pricesDaily.adjClose })
    .from(pricesDaily)
    .where(and(eq(pricesDaily.companyId, c.id), gte(pricesDaily.date, monthsAgo(now, 12))))
    .orderBy(asc(pricesDaily.date));
  const returns =
    rows.length >= 2
      ? dailyReturns(
          rows,
          rows.map((r) => r.date),
        )
      : [];
  const closes = rows.map((r) => r.adjClose);
  const stats: CompanyResearch["stats"] = {
    asOf: rows.at(-1)?.date ?? null,
    last: closes.at(-1) ?? null,
    d1: periodReturn(returns, 1),
    m1: periodReturn(returns, 21),
    m3: periodReturn(returns, 63),
    y1: returns.length >= 200 ? periodReturn(returns, returns.length) : null,
    volatility: returns.length >= 30 ? annualizedVolatility(returns) : null,
    maxDrawdown: returns.length >= 30 ? maxDrawdown(returns) : null,
    high52: closes.length ? Math.max(...closes) : null,
    low52: closes.length ? Math.min(...closes) : null,
  };

  const exp = await db
    .select({
      slug: factors.slug,
      name: factors.name,
      category: factors.category,
      magnitude: companyFactorExposures.magnitude,
      direction: companyFactorExposures.direction,
      confidence: companyFactorExposures.confidence,
      rationale: companyFactorExposures.rationale,
    })
    .from(companyFactorExposures)
    .innerJoin(factors, eq(factors.id, companyFactorExposures.factorId))
    .where(and(eq(companyFactorExposures.companyId, c.id), isNull(companyFactorExposures.validTo)));
  const exposures = exp
    .filter((e) => e.magnitude > 0)
    .map((e) => ({
      slug: e.slug,
      name: e.name,
      category: e.category,
      signed: e.magnitude * e.direction,
      confidence: e.confidence,
      rationale: e.rationale,
    }))
    .sort((a, b) => Math.abs(b.signed) - Math.abs(a.signed) || a.slug.localeCompare(b.slug));

  const all = await db
    .select({
      id: companies.id,
      ticker: companies.ticker,
      name: companies.name,
      sector: companies.sector,
    })
    .from(companies);
  const profiles = await exposureMap(db);
  const mine = profiles.get(c.id);
  let peers: CompanyResearch["peers"];
  if (mine && Object.keys(mine).length) {
    peers = all
      .filter((o) => o.id !== c.id && profiles.has(o.id))
      .map((o) => ({
        ticker: o.ticker,
        name: o.name,
        sector: o.sector,
        similarity: exposureSimilarity(mine, profiles.get(o.id)!),
        basis: "exposure" as const,
      }))
      .filter((p) => p.similarity !== null)
      .sort((a, b) => b.similarity! - a.similarity! || a.ticker.localeCompare(b.ticker))
      .slice(0, PEER_COUNT);
  } else {
    peers = all
      .filter((o) => o.id !== c.id && c.sector && o.sector === c.sector)
      .sort((a, b) => a.ticker.localeCompare(b.ticker))
      .slice(0, PEER_COUNT)
      .map((o) => ({
        ticker: o.ticker,
        name: o.name,
        sector: o.sector,
        similarity: null,
        basis: "sector" as const,
      }));
  }

  return {
    company: { ticker: c.ticker, name: c.name, sector: c.sector, industry: c.industry },
    prices: rows.map((r) => ({ date: r.date, close: r.adjClose })),
    stats,
    exposures,
    fundamentals: await loadFundamentals(db, c.id, stats.last),
    peers,
    news: await companyNews(db, c.id, c.ticker, now),
  };
}

const FUNDAMENTAL_FIELD: Record<string, keyof Omit<FiscalYear, "fiscalYear">> = {
  revenue: "revenue",
  net_income: "netIncome",
  operating_income: "operatingIncome",
  eps_diluted: "epsDiluted",
  operating_cash_flow: "operatingCashFlow",
  total_assets: "totalAssets",
  equity: "equity",
};

async function loadFundamentals(
  db: Db,
  companyId: number,
  price: number | null,
): Promise<CompanyResearch["fundamentals"]> {
  const rows = await db.select().from(fundamentals).where(eq(fundamentals.companyId, companyId));
  const byYear = new Map<number, FiscalYear>();
  const periodEnd: Record<number, string> = {};
  for (const r of rows) {
    const field = FUNDAMENTAL_FIELD[r.metric];
    if (!field) continue;
    const y = byYear.get(r.fiscalYear) ?? {
      fiscalYear: r.fiscalYear,
      revenue: null,
      netIncome: null,
      operatingIncome: null,
      epsDiluted: null,
      operatingCashFlow: null,
      totalAssets: null,
      equity: null,
    };
    y[field] = r.value;
    byYear.set(r.fiscalYear, y);
    periodEnd[r.fiscalYear] = r.periodEnd;
  }
  const years = [...byYear.values()].sort((a, b) => b.fiscalYear - a.fiscalYear).slice(0, 5);
  return { years, periodEnd, ratios: fundamentalRatios(years, price) };
}

async function companyNews(
  db: Db,
  companyId: number,
  ticker: string,
  now: Date,
): Promise<RadarItem[]> {
  const from = new Date(now.getTime() - NEWS_DAYS * 86_400_000);
  const rows: LinkRow[] = await db
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
        eq(newsCompanyLinks.companyId, companyId),
        gte(newsCompanyLinks.score, MIN_LINK_SCORE),
        gte(newsArticles.publishedAt, from),
        lte(newsArticles.publishedAt, now),
      ),
    )
    .orderBy(desc(newsArticles.publishedAt));
  const merged = mergeClusters(rows);
  const classes = await latestClassifications(
    db,
    merged.map((m) => m.earliest.id),
  );
  return merged
    .map(({ earliest, copies, perCompany }) => {
      const cl = classes.get(earliest.id) ?? null;
      const ageDays = Math.max(0, (now.getTime() - earliest.publishedAt.getTime()) / 86_400_000);
      return {
        title: earliest.title,
        url: earliest.url,
        source: earliest.source,
        publishedAt: earliest.publishedAt.toISOString(),
        session: earliest.session,
        ageDays,
        copies,
        relevance: scoreRelevance({
          links: [{ ticker, linkScore: perCompany.get(companyId) ?? 0, weight: NEUTRAL_WEIGHT }],
          classification: cl
            ? { class: cl.class as NewsClass, fundamentalImportance: cl.fundamentalImportance }
            : null,
          ageDays,
        }),
        classification: cl,
      };
    })
    .sort(
      (a, b) => b.relevance.score - a.relevance.score || b.publishedAt.localeCompare(a.publishedAt),
    )
    .slice(0, 10);
}

export type WhatIfOutcome =
  | {
      available: false;
      reason: "no_factors" | "missing_exposures" | "candidate_unprofiled" | "already_held";
      missingTickers: string[];
    }
  | {
      available: true;
      ticker: string;
      weight: number;
      score: CandidateScore;
      factorNames: Record<string, string>;
    };

/** What adding `ticker` at `weight` would do to the portfolio's hidden concentration. Pure exposure arithmetic. */
export async function whatIfAdd(
  db: Db,
  sessionId: string,
  portfolioId: string,
  tickerInput: string,
  weight: number,
): Promise<WhatIfOutcome> {
  if (!(weight > 0 && weight <= 0.5))
    throw new AppError("bad_request", "Weight must be above 0 and at most 50%");
  const c = await findCompany(db, tickerInput);
  const exp = await getPortfolioExposures(db, sessionId, portfolioId);
  if (!exp.available)
    return { available: false, reason: exp.reason, missingTickers: exp.missingTickers };
  if (exp.holdings.some((h) => h.ticker === c.ticker))
    return { available: false, reason: "already_held", missingTickers: [] };
  const profile = (await exposureMap(db)).get(c.id);
  if (!profile || Object.keys(profile).length === 0)
    return { available: false, reason: "candidate_unprofiled", missingTickers: [c.ticker] };

  const signed = new Map<string, Record<string, number>>();
  for (const cell of exp.cells) {
    const v = signed.get(cell.ticker) ?? {};
    v[cell.factor] = cell.signed;
    signed.set(cell.ticker, v);
  }
  const base = exp.holdings.map((h) => ({
    ticker: h.ticker,
    weight: h.weight,
    sector: h.sector,
    exposures: signed.get(h.ticker) ?? {},
  }));
  return {
    available: true,
    ticker: c.ticker,
    weight,
    score: scoreCandidate(base, { ticker: c.ticker, sector: c.sector, exposures: profile }, weight),
    factorNames: Object.fromEntries(exp.factors.map((f) => [f.slug, f.name])),
  };
}
