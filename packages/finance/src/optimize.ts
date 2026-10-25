/** Long-only portfolio construction on a covariance matrix. Pure arithmetic: no return forecasts are used. */

/** Euclidean projection of `v` onto {x : sum x = 1, 0 <= x_i <= cap}. Needs n * cap >= 1. */
export function projectCappedSimplex(v: readonly number[], cap = 1): number[] {
  const n = v.length;
  if (n === 0) throw new Error("empty vector");
  if (n * cap < 1 - 1e-12) throw new Error("cap too small: weights cannot add up to 1");
  const sumAt = (tau: number) => v.reduce((a, x) => a + Math.min(cap, Math.max(0, x - tau)), 0);
  let lo = Math.min(...v) - cap;
  let hi = Math.max(...v);
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (sumAt(mid) > 1) lo = mid;
    else hi = mid;
  }
  const tau = (lo + hi) / 2;
  return v.map((x) => Math.min(cap, Math.max(0, x - tau)));
}

const quad = (w: readonly number[], cov: readonly (readonly number[])[]) =>
  w.reduce((a, wi, i) => a + wi * cov[i]!.reduce((s, c, j) => s + c * w[j]!, 0), 0);

export function equalWeights(n: number): number[] {
  if (n < 1) throw new Error("need at least one asset");
  return Array<number>(n).fill(1 / n);
}

/** Each asset's share of portfolio variance: w_i (Sigma w)_i / (w' Sigma w). Sums to 1. */
export function riskShares(w: readonly number[], cov: readonly (readonly number[])[]): number[] {
  const sw = w.map((_, i) => cov[i]!.reduce((s, c, j) => s + c * w[j]!, 0));
  const variance = w.reduce((a, wi, i) => a + wi * sw[i]!, 0);
  if (variance <= 0) throw new Error("zero portfolio variance");
  return w.map((wi, i) => (wi * sw[i]!) / variance);
}

export function portfolioVariance(
  w: readonly number[],
  cov: readonly (readonly number[])[],
): number {
  return quad(w, cov);
}

/**
 * Long-only minimum-variance weights with an optional cap on any single weight, by accelerated projected gradient.
 * Converges to the exact solution of the convex problem; `iterations` is a safety limit.
 */
export function minVarianceWeights(
  cov: readonly (readonly number[])[],
  opts: { maxWeight?: number; iterations?: number } = {},
): number[] {
  const n = cov.length;
  const { maxWeight = 1, iterations = 20_000 } = opts;
  // The gradient of w' S w is 2 S w with Lipschitz constant 2 * lambda_max(S); a row-sum bound is enough.
  const lipschitz = 2 * Math.max(...cov.map((row) => row.reduce((a, c) => a + Math.abs(c), 0)));
  if (!(lipschitz > 0)) throw new Error("covariance matrix has no variance");
  const step = 1 / lipschitz;
  let w = projectCappedSimplex(equalWeights(n), maxWeight);
  let y = w;
  let t = 1;
  for (let it = 0; it < iterations; it++) {
    const grad = y.map((_, i) => 2 * cov[i]!.reduce((s, c, j) => s + c * y[j]!, 0));
    const next = projectCappedSimplex(
      y.map((yi, i) => yi - step * grad[i]!),
      maxWeight,
    );
    const tNext = (1 + Math.sqrt(1 + 4 * t * t)) / 2;
    const momentum = (t - 1) / tNext;
    y = next.map((x, i) => x + momentum * (x - w[i]!));
    const change = Math.max(...next.map((x, i) => Math.abs(x - w[i]!)));
    w = next;
    t = tNext;
    if (change < 1e-13) break;
  }
  return w;
}

/** Risk-parity weights: every asset contributes the same share of variance (long-only, fully invested). */
export function riskParityWeights(
  cov: readonly (readonly number[])[],
  opts: { iterations?: number } = {},
): number[] {
  const n = cov.length;
  const { iterations = 20_000 } = opts;
  let w = equalWeights(n);
  for (let it = 0; it < iterations; it++) {
    const shares = riskShares(w, cov);
    const err = Math.max(...shares.map((s) => Math.abs(s - 1 / n)));
    if (err < 1e-12) break;
    const next = w.map((wi, i) => wi * Math.sqrt(1 / n / shares[i]!));
    const total = next.reduce((a, b) => a + b, 0);
    w = next.map((x) => x / total);
  }
  return w;
}

/**
 * Gram matrix of holdings' signed exposure vectors: entry (i, j) is the sum over forces of s_i,f x s_j,f. For weights w the
 * quadratic form w' Q w equals the sum over forces of the squared net loading, so minimizing it (with
 * `minVarianceWeights`) finds the mix whose net dependence on every economic force is smallest.
 */
export function exposureGram(exposures: readonly (readonly number[])[]): number[][] {
  const n = exposures.length;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) =>
      exposures[i]!.reduce((a, s, f) => a + s * (exposures[j]![f] ?? 0), 0),
    ),
  );
}

/** Sum over forces of the squared net loading of the portfolio: the quantity `exposureGram` minimizes. */
export function exposureEnergy(
  w: readonly number[],
  exposures: readonly (readonly number[])[],
): number {
  const forces = Math.max(0, ...exposures.map((e) => e.length));
  let total = 0;
  for (let f = 0; f < forces; f++) {
    const net = w.reduce((a, wi, i) => a + wi * (exposures[i]![f] ?? 0), 0);
    total += net * net;
  }
  return total;
}
