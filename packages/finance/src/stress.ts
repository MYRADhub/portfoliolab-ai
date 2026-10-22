export interface StressExposure {
  /** Signed exposure to one factor: magnitude 0 to 3 times direction. */
  signed: number;
  /** How sure we are of that exposure, 0 to 1. */
  confidence: number;
}

export interface StressHolding {
  ticker: string;
  weight: number;
  exposures: Readonly<Record<string, StressExposure>>;
}

/**
 * How much a holding's value moves for each point of signed exposure under a full-size shock (1.0). An assumption,
 * not a measurement: a stock with exposure 3 to a force that makes a severe move is taken to gain or lose 9%.
 */
export const PERCENT_PER_POINT = 0.03;

/** A portfolio loss of this size (10%) is scored as the maximum vulnerability of 10. */
export const FULL_VULNERABILITY_LOSS = 0.1;

export interface StressResult {
  /** Estimated portfolio return under the scenario, as a fraction. */
  portfolioImpact: number;
  holdings: { ticker: string; weight: number; impact: number; contribution: number }[];
  /** Portfolio-level contribution of each shocked factor, largest effect first. */
  factors: { slug: string; contribution: number }[];
  /** Confidence of the exposures behind the estimate, weighted by how much each matters. Null when nothing is touched. */
  reliability: number | null;
  /** True when at least one holding is exposed to a shocked factor. */
  touched: boolean;
}

/**
 * Scenario analysis: each holding's estimated move is the sum, over shocked factors, of its signed exposure times
 * the shock times PERCENT_PER_POINT. Shocks run from -1 (severe fall) to +1 (severe rise). This is a linear
 * what-if, not a forecast, and ignores interactions between factors.
 */
export function stress(
  holdings: readonly StressHolding[],
  shocks: Readonly<Record<string, number>>,
): StressResult {
  const factorTotals = new Map<string, number>();
  let weightedConfidence = 0;
  let absTotal = 0;

  const rows = holdings.map((h) => {
    let impact = 0;
    for (const [slug, shock] of Object.entries(shocks)) {
      const e = h.exposures[slug];
      if (!e || shock === 0 || e.signed === 0) continue;
      const term = e.signed * shock * PERCENT_PER_POINT;
      impact += term;
      factorTotals.set(slug, (factorTotals.get(slug) ?? 0) + h.weight * term);
      weightedConfidence += Math.abs(h.weight * term) * e.confidence;
      absTotal += Math.abs(h.weight * term);
    }
    return { ticker: h.ticker, weight: h.weight, impact, contribution: h.weight * impact };
  });

  return {
    portfolioImpact: rows.reduce((a, r) => a + r.contribution, 0),
    holdings: rows.sort(
      (a, b) => a.contribution - b.contribution || a.ticker.localeCompare(b.ticker),
    ),
    factors: [...factorTotals.entries()]
      .map(([slug, contribution]) => ({ slug, contribution }))
      .sort(
        (a, b) =>
          Math.abs(b.contribution) - Math.abs(a.contribution) || a.slug.localeCompare(b.slug),
      ),
    reliability: absTotal === 0 ? null : weightedConfidence / absTotal,
    touched: absTotal > 0,
  };
}

/** 0 for no loss up to 10 for a loss of FULL_VULNERABILITY_LOSS or more. Gains score 0: the scenario helps. */
export function vulnerabilityScore(portfolioImpact: number): number {
  return Math.max(0, Math.min(10, (-portfolioImpact / FULL_VULNERABILITY_LOSS) * 10));
}
