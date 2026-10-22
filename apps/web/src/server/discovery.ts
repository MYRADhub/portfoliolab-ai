import { and, eq, isNull, notInArray } from "drizzle-orm";
import { companies, companyFactorExposures, factors, type Db } from "@portfolio-lab/db";
import {
  scoreCandidate,
  snapshot,
  type CandidateScore,
  type ConcentrationSnapshot,
} from "@portfolio-lab/finance";
import { AppError } from "./errors";
import { getPortfolioExposures } from "./exposures";

export const DEFAULT_CANDIDATE_WEIGHT = 0.05;

export interface DiscoveryCandidate {
  ticker: string;
  name: string;
  sector: string | null;
  effectiveFactorsAfter: number | null;
  deltaEffectiveFactors: number | null;
  deltaGrossLoading: number;
  /** True when adding it shrinks total hidden exposure: it leans against what the portfolio already has. */
  hedge: boolean;
  offsets: string[];
  adds: string[];
}

export type DiscoveryOutcome =
  | { available: false; reason: "no_factors" | "missing_exposures"; missingTickers: string[] }
  | {
      available: true;
      weight: number;
      before: ConcentrationSnapshot;
      factorNames: Record<string, string>;
      /** Sectors present among all candidates, for the filter. */
      sectors: string[];
      candidates: DiscoveryCandidate[];
    };

/**
 * Research candidates ranked by how much adding them (at `weight`) would raise the effective number of hidden
 * forces in the portfolio. This is a diversification screen, not a recommendation to buy anything.
 */
export async function getDiscovery(
  db: Db,
  sessionId: string,
  portfolioId: string,
  opts: { weight?: number; limit?: number; sector?: string } = {},
): Promise<DiscoveryOutcome> {
  const weight = opts.weight ?? DEFAULT_CANDIDATE_WEIGHT;
  if (!(weight > 0 && weight <= 0.5))
    throw new AppError("bad_request", "Weight must be above 0 and at most 50%");
  const limit = opts.limit ?? 10;
  const exp = await getPortfolioExposures(db, sessionId, portfolioId);
  if (!exp.available)
    return { available: false, reason: exp.reason, missingTickers: exp.missingTickers };

  const bySigned = new Map<string, Record<string, number>>();
  for (const c of exp.cells) {
    const v = bySigned.get(c.ticker) ?? {};
    v[c.factor] = c.signed;
    bySigned.set(c.ticker, v);
  }
  const base = exp.holdings.map((h) => ({
    ticker: h.ticker,
    weight: h.weight,
    sector: h.sector,
    exposures: bySigned.get(h.ticker) ?? {},
  }));
  const before = snapshot(base);

  const held = exp.holdings.map((h) => h.ticker);
  const rows = await db
    .select({
      ticker: companies.ticker,
      name: companies.name,
      sector: companies.sector,
      slug: factors.slug,
      magnitude: companyFactorExposures.magnitude,
      direction: companyFactorExposures.direction,
    })
    .from(companyFactorExposures)
    .innerJoin(companies, eq(companies.id, companyFactorExposures.companyId))
    .innerJoin(factors, eq(factors.id, companyFactorExposures.factorId))
    .where(
      and(
        isNull(companyFactorExposures.validTo),
        held.length ? notInArray(companies.ticker, held) : undefined,
      ),
    );

  const profiles = new Map<
    string,
    { name: string; sector: string | null; exposures: Record<string, number> }
  >();
  for (const r of rows) {
    const p = profiles.get(r.ticker) ?? { name: r.name, sector: r.sector, exposures: {} };
    p.exposures[r.slug] = r.magnitude * r.direction;
    profiles.set(r.ticker, p);
  }

  const scored = [...profiles.entries()].map(([ticker, p]) => {
    const s: CandidateScore = scoreCandidate(
      base,
      { ticker, sector: p.sector, exposures: p.exposures },
      weight,
    );
    return {
      ticker,
      name: p.name,
      sector: p.sector,
      effectiveFactorsAfter: s.after.effectiveFactors,
      deltaEffectiveFactors: s.deltaEffectiveFactors,
      deltaGrossLoading: s.deltaGrossLoading,
      hedge: s.deltaGrossLoading < 0,
      offsets: s.offsets,
      adds: s.adds,
    } satisfies DiscoveryCandidate;
  });
  scored.sort(
    (a, b) =>
      (b.deltaEffectiveFactors ?? -Infinity) - (a.deltaEffectiveFactors ?? -Infinity) ||
      a.ticker.localeCompare(b.ticker),
  );

  return {
    available: true,
    weight,
    before,
    factorNames: Object.fromEntries(exp.factors.map((f) => [f.slug, f.name])),
    sectors: [...new Set(scored.map((c) => c.sector ?? "Unclassified"))].sort(),
    candidates: scored
      .filter((c) => !opts.sector || (c.sector ?? "Unclassified") === opts.sector)
      .slice(0, limit),
  };
}
