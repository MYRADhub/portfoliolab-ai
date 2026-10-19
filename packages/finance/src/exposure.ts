/** Signed exposure per factor slug, each in [-3, 3] (magnitude * direction, ADR 0002). */
export type ExposureVector = Readonly<Record<string, number>>;

export interface HoldingExposure {
  ticker: string;
  weight: number;
  exposures: ExposureVector;
}

export interface FactorLoading {
  slug: string;
  /** Sum of weight * signed exposure. Opposing exposures cancel. */
  net: number;
  /** Sum of weight * |signed exposure|. Does not cancel. */
  gross: number;
  /** Per-holding share of the net loading, sorted by absolute size. */
  contributions: { ticker: string; value: number }[];
}

export function factorLoadings(holdings: readonly HoldingExposure[]): FactorLoading[] {
  const bySlug = new Map<string, FactorLoading>();
  for (const h of holdings) {
    for (const [slug, s] of Object.entries(h.exposures)) {
      if (s === 0) continue;
      const entry = bySlug.get(slug) ?? { slug, net: 0, gross: 0, contributions: [] };
      const value = h.weight * s;
      entry.net += value;
      entry.gross += h.weight * Math.abs(s);
      entry.contributions.push({ ticker: h.ticker, value });
      bySlug.set(slug, entry);
    }
  }
  const out = [...bySlug.values()];
  for (const l of out) l.contributions.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return out.sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.slug.localeCompare(b.slug));
}

export interface FactorConcentration {
  /** sum_f p_f^2 with p_f = |net_f| / sum|net|. Null when every net loading is zero. */
  hhi: number | null;
  /** 1 / hhi. */
  effectiveFactors: number | null;
  /** max_f p_f. */
  topShare: number | null;
  shares: { slug: string; share: number }[];
}

/** Factor HHI per ADR 0004. */
export function factorConcentration(loadings: readonly FactorLoading[]): FactorConcentration {
  const total = loadings.reduce((a, l) => a + Math.abs(l.net), 0);
  if (total === 0) return { hhi: null, effectiveFactors: null, topShare: null, shares: [] };
  const shares = loadings
    .map((l) => ({ slug: l.slug, share: Math.abs(l.net) / total }))
    .filter((s) => s.share > 0)
    .sort((a, b) => b.share - a.share);
  const hhi = shares.reduce((a, s) => a + s.share * s.share, 0);
  return { hhi, effectiveFactors: 1 / hhi, topShare: shares[0]!.share, shares };
}

/** Cosine similarity of two exposure vectors, or null if either is all zeros. */
export function cosineSimilarity(a: ExposureVector, b: ExposureVector): number | null {
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

export interface PairOverlap {
  a: string;
  b: string;
  similarity: number | null;
  /** Factors where both holdings have the same sign: shared vulnerability. */
  shared: string[];
  /** Factors where the signs differ: the holdings hedge each other. */
  offsetting: string[];
}

/** All holding pairs, most similar first (pairs with no defined similarity last). */
export function pairOverlaps(holdings: readonly HoldingExposure[]): PairOverlap[] {
  const out: PairOverlap[] = [];
  for (let i = 0; i < holdings.length; i++) {
    for (let j = i + 1; j < holdings.length; j++) {
      const x = holdings[i]!;
      const y = holdings[j]!;
      const shared: string[] = [];
      const offsetting: string[] = [];
      for (const [k, v] of Object.entries(x.exposures)) {
        const w = y.exposures[k] ?? 0;
        if (v === 0 || w === 0) continue;
        (Math.sign(v) === Math.sign(w) ? shared : offsetting).push(k);
      }
      out.push({
        a: x.ticker,
        b: y.ticker,
        similarity: cosineSimilarity(x.exposures, y.exposures),
        shared: shared.sort(),
        offsetting: offsetting.sort(),
      });
    }
  }
  return out.sort((p, q) => (q.similarity ?? -2) - (p.similarity ?? -2) || p.a.localeCompare(q.a));
}
