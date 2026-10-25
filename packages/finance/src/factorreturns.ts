/**
 * What did each hidden force actually do? Each day, every stock's return is regressed on that stock's exposure scores
 * (a cross-sectional regression, as in Fama and MacBeth). The coefficient on a force is that day's return of the force:
 * how much more the stocks that depend on it moved, per exposure point. Stringing the days together shows whether the
 * exposure scores line up with real market behaviour, and lets a portfolio's return be split by force.
 */

/** Solves A x = b by Gaussian elimination with partial pivoting; null when A is singular. */
export function solveLinear(
  a: readonly (readonly number[])[],
  b: readonly number[],
): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    if (Math.abs(m[piv]![col]!) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv]!, m[col]!];
    for (let r = col + 1; r < n; r++) {
      const f = m[r]![col]! / m[col]![col]!;
      for (let c = col; c <= n; c++) m[r]![c]! -= f * m[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r]![n]!;
    for (let c = r + 1; c < n; c++) s -= m[r]![c]! * x[c]!;
    x[r] = s / m[r]![r]!;
  }
  return x;
}

export interface CrossSectionFit {
  /** The day's average return of a stock with no exposures (the market-wide part). */
  intercept: number;
  /** One coefficient per force: that day's return of the force per exposure point. */
  coefficients: number[];
  /** Share of that day's differences between stocks the exposures explain, penalised for the number of forces. */
  adjustedR2: number;
  n: number;
}

/**
 * Ridge regression of one day's stock returns on exposure scores, with an unpenalised intercept. A small ridge keeps
 * forces that nearly always appear together from producing wild offsetting coefficients. Null when there are not
 * clearly more stocks than forces or the system is degenerate.
 */
export function crossSectionFit(
  loadings: readonly (readonly number[])[],
  returns: readonly number[],
  ridge = 1,
): CrossSectionFit | null {
  const n = returns.length;
  if (loadings.length !== n) throw new Error("series length mismatch");
  const k = n === 0 ? 0 : loadings[0]!.length;
  if (n < k + 3) return null;
  const p = k + 1;
  const xtx = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xty = new Array<number>(p).fill(0);
  for (let i = 0; i < n; i++) {
    const row = [1, ...loadings[i]!];
    for (let a = 0; a < p; a++) {
      xty[a]! += row[a]! * returns[i]!;
      for (let b = 0; b < p; b++) xtx[a]![b]! += row[a]! * row[b]!;
    }
  }
  for (let a = 1; a < p; a++) xtx[a]![a]! += ridge;
  const beta = solveLinear(xtx, xty);
  if (!beta) return null;
  const meanY = returns.reduce((s, v) => s + v, 0) / n;
  let sse = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    let fit = beta[0]!;
    for (let j = 0; j < k; j++) fit += beta[j + 1]! * loadings[i]![j]!;
    sse += (returns[i]! - fit) ** 2;
    sst += (returns[i]! - meanY) ** 2;
  }
  const adjustedR2 = sst > 0 ? 1 - sse / (n - p) / (sst / (n - 1)) : 0;
  return { intercept: beta[0]!, coefficients: beta.slice(1), adjustedR2, n };
}

export interface FactorAttribution {
  /** Per force: sum over days of (portfolio net exposure to the force) x (the force's return that day). */
  byFactor: number[];
  /** Sum over days of the market-wide intercept times the weights (weights are normalised to sum to 1). */
  market: number;
  /** What the exposures do not explain: portfolio return minus the two parts above. */
  residual: number;
  /** Sum of the portfolio's daily returns. Always equals byFactor + market + residual. */
  total: number;
}

/**
 * Splits a portfolio's summed daily returns into force contributions, a market-wide part and a residual. Because the
 * residual is whatever is left, the parts add to the total exactly, which is what makes this checkable.
 * `weights` are normalised; `holdingLoadings[i][k]` is holding i's score on force k; `daily[t]` carries that day's fit
 * and the holdings' returns.
 */
export function attributeToFactors(
  weights: readonly number[],
  holdingLoadings: readonly (readonly number[])[],
  daily: readonly {
    intercept: number;
    coefficients: readonly number[];
    holdingReturns: readonly number[];
  }[],
): FactorAttribution {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) throw new Error("weights must sum to a positive number");
  const w = weights.map((x) => x / sum);
  const k = holdingLoadings[0]?.length ?? 0;
  const net = Array.from({ length: k }, (_, j) =>
    w.reduce((s, wi, i) => s + wi * holdingLoadings[i]![j]!, 0),
  );
  const byFactor = new Array<number>(k).fill(0);
  let market = 0;
  let total = 0;
  for (const d of daily) {
    market += d.intercept;
    for (let j = 0; j < k; j++) byFactor[j]! += net[j]! * d.coefficients[j]!;
    total += w.reduce((s, wi, i) => s + wi * d.holdingReturns[i]!, 0);
  }
  const explained = byFactor.reduce((a, b) => a + b, 0) + market;
  return { byFactor, market, residual: total - explained, total };
}
