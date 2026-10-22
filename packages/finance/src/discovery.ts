import { concentration } from "./weights";
import {
  factorConcentration,
  factorLoadings,
  type ExposureVector,
  type HoldingExposure,
} from "./exposure";

export interface CandidateProfile {
  ticker: string;
  sector: string | null;
  exposures: ExposureVector;
}

export interface ConcentrationSnapshot {
  effectiveFactors: number | null;
  effectiveSectors: number;
  factorHhi: number | null;
  /** Sum of absolute net factor loadings: how much total hidden exposure there is, regardless of how it is spread. */
  grossLoading: number;
  topFactor: { slug: string; share: number } | null;
}

/** Concentration of a set of holdings by hidden force and by sector. Weights are renormalized to sum to 1. */
export function snapshot(
  holdings: readonly (HoldingExposure & { sector?: string | null })[],
): ConcentrationSnapshot {
  const total = holdings.reduce((a, h) => a + h.weight, 0);
  const norm = holdings.map((h) => ({ ...h, weight: h.weight / total }));
  const loadings = factorLoadings(norm);
  const c = factorConcentration(loadings);
  const bySector = new Map<string, number>();
  for (const h of norm)
    bySector.set(
      h.sector ?? "Unclassified",
      (bySector.get(h.sector ?? "Unclassified") ?? 0) + h.weight,
    );
  return {
    effectiveFactors: c.effectiveFactors,
    effectiveSectors: concentration([...bySector.values()]).effectiveN,
    factorHhi: c.hhi,
    grossLoading: loadings.reduce((a, l) => a + Math.abs(l.net), 0),
    topFactor: c.shares[0] ? { slug: c.shares[0].slug, share: c.shares[0].share } : null,
  };
}

export interface CandidateScore {
  ticker: string;
  sector: string | null;
  before: ConcentrationSnapshot;
  after: ConcentrationSnapshot;
  /** after - before in effective number of factors; positive means the portfolio becomes less concentrated. */
  deltaEffectiveFactors: number | null;
  /** after - before in gross loading; negative means total hidden exposure shrinks (a hedge). */
  deltaGrossLoading: number;
  /** Factors on which the candidate leans against the portfolio's current net loading: they offset a concentration. */
  offsets: string[];
  /** The factors the candidate adds most exposure to. */
  adds: string[];
}

/**
 * What happens to hidden concentration if `candidate` is added at `weight` (existing holdings are scaled down to make
 * room). Pure arithmetic on the exposure profiles; it says nothing about the candidate's expected return.
 */
export function scoreCandidate(
  holdings: readonly (HoldingExposure & { sector?: string | null })[],
  candidate: CandidateProfile,
  weight: number,
): CandidateScore {
  if (!(weight > 0 && weight < 1)) throw new Error("weight must be between 0 and 1");
  const before = snapshot(holdings);
  const scaled = holdings.map((h) => ({ ...h, weight: h.weight * (1 - weight) }));
  const after = snapshot([
    ...scaled,
    { ticker: candidate.ticker, weight, exposures: candidate.exposures, sector: candidate.sector },
  ]);

  const current = new Map(factorLoadings(holdings).map((l) => [l.slug, l.net]));
  const offsets = Object.entries(candidate.exposures)
    .filter(
      ([slug, v]) =>
        v !== 0 && (current.get(slug) ?? 0) !== 0 && Math.sign(v) !== Math.sign(current.get(slug)!),
    )
    .map(([slug]) => slug)
    .sort();
  const adds = Object.entries(candidate.exposures)
    .filter(([, v]) => v !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([slug]) => slug);

  return {
    ticker: candidate.ticker,
    sector: candidate.sector,
    before,
    after,
    deltaEffectiveFactors:
      before.effectiveFactors === null || after.effectiveFactors === null
        ? null
        : after.effectiveFactors - before.effectiveFactors,
    deltaGrossLoading: after.grossLoading - before.grossLoading,
    offsets,
    adds,
  };
}

/** Cosine similarity of two signed exposure vectors: 1 identical profile, 0 unrelated, -1 opposite. Null if either is empty. */
export function exposureSimilarity(a: ExposureVector, b: ExposureVector): number | null {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of Object.entries(a)) {
    na += v * v;
    dot += v * (b[k] ?? 0);
  }
  for (const v of Object.values(b)) nb += v * v;
  if (na === 0 || nb === 0) return null;
  return dot / Math.sqrt(na * nb);
}
