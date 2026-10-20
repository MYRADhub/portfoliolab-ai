export type NewsClass = "fundamental" | "narrative" | "noise" | "unclear";

export interface RelevanceLink {
  ticker: string;
  /** How sure we are the article is about this company, 0 to 1. */
  linkScore: number;
  /** The holding's weight in the portfolio, as a fraction. */
  weight: number;
}

export interface RelevanceInput {
  links: readonly RelevanceLink[];
  classification: { class: NewsClass; fundamentalImportance: number } | null;
  ageDays: number;
}

export interface RelevanceResult {
  /** 0 to 10. */
  score: number;
  /** 0 to 1: how strongly the article touches what the investor holds. */
  exposureMatch: number;
  /** 0 to 1: how much the information could change a company's economics. */
  impact: number;
  /** 0 to 1: freshness. */
  recency: number;
  matched: { ticker: string; linkScore: number; weight: number; contribution: number }[];
}

/** A holding this large or larger counts fully; smaller holdings count down to 40%. */
export const WEIGHT_FULL_AT = 0.25;
export const MIN_WEIGHT_FACTOR = 0.4;
/** Half the relevance is lost every three days. */
export const HALF_LIFE_DAYS = 3;
/** Impact used when an article has not been classified yet: neutral, never high. */
export const UNCLASSIFIED_IMPACT = 0.5;
/** The most impact each class can claim, so gossip cannot outrank a real earnings change. */
export const CLASS_IMPACT_CAP: Record<NewsClass, number> = {
  fundamental: 1,
  narrative: 0.6,
  unclear: 0.3,
  noise: 0.2,
};

export function weightFactor(weight: number): number {
  return (
    MIN_WEIGHT_FACTOR + (1 - MIN_WEIGHT_FACTOR) * Math.min(1, Math.max(0, weight) / WEIGHT_FULL_AT)
  );
}

export function impactOf(classification: RelevanceInput["classification"]): number {
  if (!classification) return UNCLASSIFIED_IMPACT;
  const base = Math.max(0.1, classification.fundamentalImportance / 10);
  return Math.min(base, CLASS_IMPACT_CAP[classification.class]);
}

export function recencyOf(ageDays: number): number {
  return 0.5 ** (Math.max(0, ageDays) / HALF_LIFE_DAYS);
}

/**
 * How much one investor should care about one article, 0 to 10:
 * exposure match (noisy-or over their holdings) x impact x recency x 10.
 * Every part is returned so the screen can show why an item ranks where it does.
 */
export function scoreRelevance(input: RelevanceInput): RelevanceResult {
  const matched = input.links.map((l) => ({
    ticker: l.ticker,
    linkScore: l.linkScore,
    weight: l.weight,
    contribution: l.linkScore * weightFactor(l.weight),
  }));
  const exposureMatch =
    matched.length === 0 ? 0 : 1 - matched.reduce((a, m) => a * (1 - m.contribution), 1);
  const impact = impactOf(input.classification);
  const recency = recencyOf(input.ageDays);
  return { score: 10 * exposureMatch * impact * recency, exposureMatch, impact, recency, matched };
}
