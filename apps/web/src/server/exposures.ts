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

export type PortfolioExposures =
  | { available: false; reason: "no_factors" | "missing_exposures"; missingTickers: string[] }
  | {
      available: true;
      portfolio: { id: string; name: string };
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

/** Factor exposure view for a session-owned portfolio. Requires current exposures for every holding. */
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

  const hs = await db
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
        inArray(
          companyFactorExposures.companyId,
          hs.map((h) => h.companyId),
        ),
        isNull(companyFactorExposures.validTo),
      ),
    );

  const covered = new Set(rows.map((r) => r.companyId));
  const missingTickers = hs.filter((h) => !covered.has(h.companyId)).map((h) => h.ticker);
  if (rows.length === 0) return { available: false, reason: "no_factors", missingTickers };
  if (missingTickers.length)
    return { available: false, reason: "missing_exposures", missingTickers };

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
