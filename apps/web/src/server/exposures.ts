import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  companies,
  companyFactorExposures,
  factors,
  holdings,
  portfolios,
  type Db,
} from "@portfolio-lab/db";
import {
  concentration,
  factorConcentration,
  factorLoadings,
  pairOverlaps,
  type HoldingExposure,
} from "@portfolio-lab/finance";
import { AppError } from "./errors";

export interface ExposureCell {
  ticker: string;
  factor: string;
  signed: number;
  confidence: number;
  rationale: string | null;
  /** The annual-report passage behind a grounded draft, checked to appear in the report. */
  evidence: string | null;
  /** Link to the report the passage comes from. */
  source: string | null;
  /** Share of repeated drafting runs that gave exactly this score. */
  stability: number | null;
}

/**
 * Analyses that rest on exposure profiles run on the holdings that have one, with their weights scaled up to 100%,
 * as long as those holdings make up at least this share of the portfolio. Below it the result would describe too
 * little of the portfolio to be useful, so the analysis says what is missing instead.
 */
export const MIN_PROFILED_SHARE = 0.5;

/** How much of a portfolio an exposure-based analysis covers. */
export interface ExposureCoverage {
  /** Share of the portfolio's weight held in profiled companies, 0 to 1. */
  share: number;
  profiled: number;
  total: number;
  /** Holdings left out because they have no profile, with their original weights. */
  missing: { ticker: string; weight: number }[];
}

/**
 * Splits holdings into profiled and not, and rescales the profiled ones to sum to 1. `usable` is false when the
 * profiled part is below MIN_PROFILED_SHARE of the portfolio or empty.
 */
export function profiledPart<T extends { ticker: string; weight: number }>(
  hs: readonly T[],
  isProfiled: (h: T) => boolean,
): { holdings: T[]; coverage: ExposureCoverage; usable: boolean } {
  const total = hs.reduce((a, h) => a + h.weight, 0);
  const inside = hs.filter(isProfiled);
  const insideWeight = inside.reduce((a, h) => a + h.weight, 0);
  const share = total > 0 ? insideWeight / total : 0;
  const coverage: ExposureCoverage = {
    share,
    profiled: inside.length,
    total: hs.length,
    missing: hs
      .filter((h) => !isProfiled(h))
      .map((h) => ({ ticker: h.ticker, weight: total > 0 ? h.weight / total : 0 }))
      .sort((a, b) => b.weight - a.weight || a.ticker.localeCompare(b.ticker)),
  };
  return {
    holdings: inside.map((h) => ({ ...h, weight: insideWeight > 0 ? h.weight / insideWeight : 0 })),
    coverage,
    // A tiny tolerance so a portfolio that is exactly half profiled is not refused by rounding.
    usable: inside.length > 0 && share >= MIN_PROFILED_SHARE - 1e-9,
  };
}

/**
 * A fact stating what an exposure-based figure covers, for explanations and the assistant, so a figure about the
 * profiled part is never read as one about the whole portfolio. Null when every holding is profiled.
 */
export function coverageFact(
  c: ExposureCoverage | undefined,
): { label: string; text: string } | null {
  if (!c || c.missing.length === 0) return null;
  return {
    label: "Exposure profiles cover",
    text: `${Math.round(c.share * 100)}% of the portfolio by weight; left out for lack of a profile: ${c.missing
      .map((m) => m.ticker)
      .join(", ")}. Exposure figures describe the profiled part.`,
  };
}

export type PortfolioExposures =
  | {
      available: false;
      reason: "no_factors" | "missing_exposures";
      missingTickers: string[];
      coverage?: ExposureCoverage;
    }
  | {
      available: true;
      portfolio: { id: string; name: string };
      /** Which holdings the figures describe; weights below are scaled to the profiled part. */
      coverage: ExposureCoverage;
      /** Each holding with its weight, for drawing the exposure graph. */
      holdings: { ticker: string; weight: number; sector: string }[];
      factors: {
        slug: string;
        name: string;
        category: string;
        net: number;
        gross: number;
        share: number;
        contributions: { ticker: string; value: number }[];
      }[];
      /** Factor view vs. sector view of the same weights: the product's core comparison. */
      concentration: {
        factorHhi: number | null;
        effectiveFactors: number | null;
        topFactorShare: number | null;
        sectorHhi: number;
        effectiveSectors: number;
      };
      cells: ExposureCell[];
      pairs: {
        a: string;
        b: string;
        similarity: number | null;
        shared: string[];
        offsetting: string[];
      }[];
    };

/**
 * True when every holding has a profile. Analyses that treat a missing profile as zero exposure (fit, rebalancing to
 * the smallest net exposure, what-if scores, discovery, comparisons) need this; the exposure map, stress tests and
 * force attribution work on the profiled part and say so.
 */
export function isFullyProfiled(x: PortfolioExposures): boolean {
  return x.available && x.coverage.missing.length === 0;
}

/**
 * Factor exposure view for a session-owned portfolio. Holdings without a current profile are left out and the rest
 * rescaled (see `profiledPart`); the result says which were left out.
 */
export async function getPortfolioExposures(
  db: Db,
  sessionId: string,
  portfolioId: string,
): Promise<PortfolioExposures> {
  const [p] = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.sessionId, sessionId)));
  if (!p) throw new AppError("not_found", "Portfolio not found");

  const all = await db
    .select({
      companyId: companies.id,
      ticker: companies.ticker,
      sector: companies.sector,
      weight: holdings.weight,
    })
    .from(holdings)
    .innerJoin(companies, eq(companies.id, holdings.companyId))
    .where(eq(holdings.portfolioId, portfolioId));

  const rows = await db
    .select({
      companyId: companyFactorExposures.companyId,
      slug: factors.slug,
      name: factors.name,
      category: factors.category,
      magnitude: companyFactorExposures.magnitude,
      direction: companyFactorExposures.direction,
      confidence: companyFactorExposures.confidence,
      rationale: companyFactorExposures.rationale,
      evidenceQuote: companyFactorExposures.evidenceQuote,
      evidenceUrls: companyFactorExposures.evidenceUrls,
      stability: companyFactorExposures.stability,
    })
    .from(companyFactorExposures)
    .innerJoin(factors, eq(factors.id, companyFactorExposures.factorId))
    .where(
      and(
        inArray(companyFactorExposures.companyId, all.length ? all.map((h) => h.companyId) : [-1]),
        isNull(companyFactorExposures.validTo),
      ),
    );

  const covered = new Set(rows.map((r) => r.companyId));
  const part = profiledPart(all, (h) => covered.has(h.companyId));
  const missingTickers = part.coverage.missing.map((m) => m.ticker);
  if (rows.length === 0)
    return { available: false, reason: "no_factors", missingTickers, coverage: part.coverage };
  if (!part.usable)
    return {
      available: false,
      reason: "missing_exposures",
      missingTickers,
      coverage: part.coverage,
    };
  const hs = part.holdings;

  const byCompany = new Map<number, Record<string, number>>();
  for (const r of rows) {
    const v = byCompany.get(r.companyId) ?? {};
    v[r.slug] = r.magnitude * r.direction;
    byCompany.set(r.companyId, v);
  }
  const hx: HoldingExposure[] = hs.map((h) => ({
    ticker: h.ticker,
    weight: h.weight,
    exposures: byCompany.get(h.companyId) ?? {},
  }));

  const loadings = factorLoadings(hx);
  const conc = factorConcentration(loadings);
  const shareBySlug = new Map(conc.shares.map((s) => [s.slug, s.share]));
  const meta = new Map(rows.map((r) => [r.slug, r]));
  const sectorWeights = new Map<string, number>();
  for (const h of hs)
    sectorWeights.set(
      h.sector ?? "Unclassified",
      (sectorWeights.get(h.sector ?? "Unclassified") ?? 0) + h.weight,
    );
  const sector = concentration([...sectorWeights.values()]);
  const tickerById = new Map(hs.map((h) => [h.companyId, h.ticker]));

  return {
    available: true,
    portfolio: { id: p.id, name: p.name },
    coverage: part.coverage,
    holdings: [...hs]
      .sort((a, b) => b.weight - a.weight || a.ticker.localeCompare(b.ticker))
      .map((h) => ({ ticker: h.ticker, weight: h.weight, sector: h.sector ?? "Unclassified" })),
    factors: loadings.map((l) => ({
      slug: l.slug,
      name: meta.get(l.slug)!.name,
      category: meta.get(l.slug)!.category,
      net: l.net,
      gross: l.gross,
      share: shareBySlug.get(l.slug) ?? 0,
      contributions: l.contributions,
    })),
    concentration: {
      factorHhi: conc.hhi,
      effectiveFactors: conc.effectiveFactors,
      topFactorShare: conc.topShare,
      sectorHhi: sector.hhi,
      effectiveSectors: sector.effectiveN,
    },
    cells: rows
      .filter((r) => r.magnitude > 0)
      .map((r) => ({
        ticker: tickerById.get(r.companyId)!,
        factor: r.slug,
        signed: r.magnitude * r.direction,
        confidence: r.confidence,
        rationale: r.rationale,
        evidence: r.evidenceQuote,
        source: r.evidenceUrls[0] ?? null,
        stability: r.stability,
      })),
    pairs: pairOverlaps(hx),
  };
}
