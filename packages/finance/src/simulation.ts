/** Resampling-based projection of a portfolio's possible paths from its own history. Illustrative, not a forecast. */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimulationResult {
  /** Trading day numbers at which the paths were recorded (0 is the start). */
  checkpoints: number[];
  /** Growth multiple of 1 unit at each checkpoint, one row per path. */
  values: number[][];
  /** Final growth multiple per path. */
  terminal: number[];
  /** Worst peak-to-trough fall per path, as a negative fraction. */
  maxDrawdowns: number[];
}

/**
 * Circular block bootstrap: each path is built by repeatedly drawing a random starting day in `returns` and copying
 * `blockSize` consecutive daily returns (wrapping around the end), so short-term streaks are kept. Seeded, so the same
 * inputs always give the same paths.
 */
export function simulateGrowth(
  returns: readonly number[],
  opts: {
    horizonDays: number;
    paths: number;
    blockSize?: number;
    seed?: number;
    checkpointEvery?: number;
    /**
     * Re-centers the history on this arithmetic annual return before resampling, keeping its volatility and shape.
     * Leave undefined to keep the history's own average, which carries any boom or bust in it into the future.
     */
    annualDrift?: number;
  },
): SimulationResult {
  const { horizonDays, paths, blockSize = 10, seed = 1, checkpointEvery = 21, annualDrift } = opts;
  const n = returns.length;
  if (n < 2) throw new Error("need at least 2 observed returns");
  if (horizonDays < 1 || paths < 1 || blockSize < 1) throw new Error("invalid simulation size");
  if (annualDrift !== undefined) {
    const target = annualDrift / 252;
    const m = returns.reduce((a, r) => a + r, 0) / n;
    returns = returns.map((r) => r - m + target);
  }
  const rand = mulberry32(seed);
  const checkpoints: number[] = [0];
  for (let d = checkpointEvery; d < horizonDays; d += checkpointEvery) checkpoints.push(d);
  checkpoints.push(horizonDays);

  const values: number[][] = [];
  const terminal: number[] = [];
  const maxDrawdowns: number[] = [];
  for (let p = 0; p < paths; p++) {
    let value = 1;
    let peak = 1;
    let worst = 0;
    const row: number[] = [1];
    let cp = 1;
    let day = 0;
    while (day < horizonDays) {
      const start = Math.floor(rand() * n);
      for (let k = 0; k < blockSize && day < horizonDays; k++, day++) {
        value *= 1 + returns[(start + k) % n]!;
        if (value > peak) peak = value;
        const dd = value / peak - 1;
        if (dd < worst) worst = dd;
        if (day + 1 === checkpoints[cp]) {
          row.push(value);
          cp++;
        }
      }
    }
    values.push(row);
    terminal.push(value);
    maxDrawdowns.push(worst);
  }
  return { checkpoints, values, terminal, maxDrawdowns };
}

/** Linear-interpolated quantile of an unsorted sample, q in [0, 1]. */
export function quantile(sample: readonly number[], q: number): number {
  if (sample.length === 0) throw new Error("empty sample");
  const s = [...sample].sort((a, b) => a - b);
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** For every checkpoint, the requested quantiles of the growth multiple across paths. */
export function fanBands(result: SimulationResult, qs: readonly number[]): number[][] {
  return result.checkpoints.map((_, c) =>
    qs.map((q) =>
      quantile(
        result.values.map((row) => row[c]!),
        q,
      ),
    ),
  );
}

/** Share of values strictly below `threshold`. */
export function shareBelow(sample: readonly number[], threshold: number): number {
  if (sample.length === 0) throw new Error("empty sample");
  return sample.filter((v) => v < threshold).length / sample.length;
}
