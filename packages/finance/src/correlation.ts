import { mean } from "./metrics";

export function pearson(x: readonly number[], y: readonly number[]): number {
  if (x.length !== y.length) throw new Error("series length mismatch");
  if (x.length < 3) throw new Error("need at least 3 observations");
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) throw new Error("zero variance series has no correlation");
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

export function correlationMatrix(returnsByAsset: readonly (readonly number[])[]): number[][] {
  const n = returnsByAsset.length;
  const m: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(1));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      m[i]![j] = m[j]![i] = pearson(returnsByAsset[i]!, returnsByAsset[j]!);
    }
  }
  return m;
}

/** Mean of the off-diagonal entries. Null for fewer than two assets. */
export function averagePairwise(matrix: readonly (readonly number[])[]): number | null {
  const n = matrix.length;
  if (n < 2) return null;
  let sum = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) sum += matrix[i]![j]!;
  return sum / ((n * (n - 1)) / 2);
}

/** Sample covariance matrix (n - 1). */
export function covarianceMatrix(returnsByAsset: readonly (readonly number[])[]): number[][] {
  const n = returnsByAsset.length;
  const t = returnsByAsset[0]?.length ?? 0;
  if (t < 2) throw new Error("need at least 2 observations");
  const means = returnsByAsset.map((r) => mean(r));
  const cov: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      for (let k = 0; k < t; k++)
        s += (returnsByAsset[i]![k]! - means[i]!) * (returnsByAsset[j]![k]! - means[j]!);
      cov[i]![j] = cov[j]![i] = s / (t - 1);
    }
  }
  return cov;
}

/** (sum w_i sigma_i) / sigma_portfolio. 1 means no diversification benefit; higher is more diversified. */
export function diversificationRatio(
  weights: readonly number[],
  returnsByAsset: readonly (readonly number[])[],
): number {
  const cov = covarianceMatrix(returnsByAsset);
  const weightedVol = weights.reduce((a, w, i) => a + w * Math.sqrt(cov[i]![i]!), 0);
  let variance = 0;
  for (let i = 0; i < weights.length; i++)
    for (let j = 0; j < weights.length; j++) variance += weights[i]! * weights[j]! * cov[i]![j]!;
  if (variance <= 0) throw new Error("zero portfolio variance");
  return weightedVol / Math.sqrt(variance);
}

/** Correlation of each asset with a reference series (for example the portfolio). */
export function correlationWith(
  reference: readonly number[],
  returnsByAsset: readonly (readonly number[])[],
): number[] {
  return returnsByAsset.map((r) => pearson(r, reference));
}

/** Rolling Pearson correlation; element i covers observations [i, i + window). */
export function rollingCorrelation(
  x: readonly number[],
  y: readonly number[],
  window: number,
): number[] {
  if (x.length !== y.length) throw new Error("series length mismatch");
  if (window < 3 || window > x.length)
    throw new Error("window must be between 3 and the series length");
  const out: number[] = [];
  for (let i = 0; i + window <= x.length; i++)
    out.push(pearson(x.slice(i, i + window), y.slice(i, i + window)));
  return out;
}

/** Observations falling on the worst `fraction` of days for `reference`. Used for stress-period correlation. */
export function worstDaysIndices(reference: readonly number[], fraction: number): number[] {
  const k = Math.max(1, Math.floor(reference.length * fraction));
  return reference
    .map((r, i) => [r, i] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .slice(0, k)
    .map(([, i]) => i)
    .sort((a, b) => a - b);
}

/**
 * Leaf order from average-linkage hierarchical clustering on distance 1 - rho, so that similar assets are
 * adjacent in a heatmap. Deterministic: ties break toward the lower index.
 */
export function clusterOrder(matrix: readonly (readonly number[])[]): number[] {
  const n = matrix.length;
  let clusters: { members: number[]; order: number[] }[] = Array.from({ length: n }, (_, i) => ({
    members: [i],
    order: [i],
  }));
  const dist = (a: number[], b: number[]) => {
    let s = 0;
    for (const i of a) for (const j of b) s += 1 - matrix[i]![j]!;
    return s / (a.length * b.length);
  };
  while (clusters.length > 1) {
    let best = { i: 0, j: 1, d: Infinity };
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = dist(clusters[i]!.members, clusters[j]!.members);
        if (d < best.d - 1e-12) best = { i, j, d };
      }
    }
    const a = clusters[best.i]!;
    const b = clusters[best.j]!;
    const merged = { members: [...a.members, ...b.members], order: [...a.order, ...b.order] };
    clusters = clusters.filter((_, k) => k !== best.i && k !== best.j);
    clusters.push(merged);
  }
  return clusters[0]?.order ?? [];
}
