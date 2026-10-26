import { mean, stdev } from "./metrics";

export type Arm = "control" | "treatment";

/**
 * Minimization within a stratum: the arm with fewer participants so far gets the next one, and a tie is broken by
 * `rand` in [0, 1). Keeps the arms within one participant of each other in every stratum while staying unpredictable
 * on ties.
 */
export function assignArm(counts: { control: number; treatment: number }, rand: number): Arm {
  if (counts.control < counts.treatment) return "control";
  if (counts.treatment < counts.control) return "treatment";
  return rand < 0.5 ? "control" : "treatment";
}

/** Inverse of the standard normal CDF (Acklam's rational approximation, relative error about 1e-9). */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new Error("p must be in (0, 1)");
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (p > 1 - low) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}

/**
 * Participants needed in each arm to detect a standardized difference `d` (Cohen's d) with a two-sided test at
 * `alpha` and the given power, using the normal approximation: n = 2 * ((z_alpha/2 + z_power) / d)^2.
 */
export function requiredPerArm(d: number, alpha = 0.05, power = 0.8): number {
  if (!(d > 0)) throw new Error("effect size must be positive");
  const z = normalQuantile(1 - alpha / 2) + normalQuantile(power);
  return Math.ceil(2 * (z / d) ** 2);
}

export interface ArmComparison {
  nControl: number;
  nTreatment: number;
  meanControl: number;
  meanTreatment: number;
  /** treatment minus control. */
  difference: number;
  /** Welch's t for the difference. Null when either arm has fewer than 2 values or both have no variance. */
  t: number | null;
  /** Cohen's d with the pooled standard deviation. Null when it cannot be computed. */
  cohensD: number | null;
  /** Two-sided permutation p-value for the difference in means (seeded, so repeatable). Null if an arm is empty. */
  permutationP: number | null;
}

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

/** Compares an outcome between arms: difference, Welch t, Cohen's d and a permutation p-value. */
export function compareArms(
  control: readonly number[],
  treatment: readonly number[],
  opts: { seed?: number; resamples?: number } = {},
): ArmComparison {
  const { seed = 1, resamples = 10_000 } = opts;
  const nC = control.length;
  const nT = treatment.length;
  const mC = nC ? mean(control) : NaN;
  const mT = nT ? mean(treatment) : NaN;
  const diff = mT - mC;
  let t: number | null = null;
  let d: number | null = null;
  if (nC >= 2 && nT >= 2) {
    const vC = stdev(control) ** 2;
    const vT = stdev(treatment) ** 2;
    const se = Math.sqrt(vC / nC + vT / nT);
    t = se > 0 ? diff / se : null;
    const pooled = Math.sqrt(((nC - 1) * vC + (nT - 1) * vT) / (nC + nT - 2));
    d = pooled > 0 ? diff / pooled : null;
  }
  let p: number | null = null;
  if (nC >= 1 && nT >= 1) {
    const all = [...control, ...treatment];
    const rand = mulberry32(seed);
    let extreme = 0;
    for (let r = 0; r < resamples; r++) {
      // Fisher-Yates shuffle, then split at the original sizes.
      for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [all[i], all[j]] = [all[j]!, all[i]!];
      }
      let sT = 0;
      for (let i = 0; i < nT; i++) sT += all[i]!;
      const permDiff = sT / nT - all.slice(nT).reduce((s, v) => s + v, 0) / nC;
      if (Math.abs(permDiff) >= Math.abs(diff) - 1e-12) extreme++;
    }
    p = (extreme + 1) / (resamples + 1);
  }
  return {
    nControl: nC,
    nTreatment: nT,
    meanControl: mC,
    meanTreatment: mT,
    difference: diff,
    t,
    cohensD: d,
    permutationP: p,
  };
}

/**
 * Eigenvalues and eigenvectors of a symmetric matrix by cyclic Jacobi rotations. Fine for the small matrices here
 * (a portfolio of at most a few dozen holdings). Vectors are the columns of `vectors`.
 */
export function symmetricEigen(m: readonly (readonly number[])[]): {
  values: number[];
  vectors: number[][];
} {
  const n = m.length;
  const a = m.map((r) => [...r]);
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p]![q]! ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        const apq = a[p]![q]!;
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
  }
  return { values: a.map((r, i) => r[i]!), vectors: v };
}

/**
 * Effective number of independent bets (Meucci 2009): split the portfolio's variance across the principal components
 * of the holdings' return covariance and take exp(entropy) of those shares. It is 1 when one source drives all the
 * risk and equals the number of holdings when the risk is spread evenly over independent sources. It uses returns
 * only, so it checks the exposure-based outcome with a measure that does not depend on our exposure scores.
 * Null when the portfolio has no variance.
 */
export function effectiveBets(
  weights: readonly number[],
  covariance: readonly (readonly number[])[],
): number | null {
  if (weights.length !== covariance.length)
    throw new Error("weights and covariance differ in size");
  const { values, vectors } = symmetricEigen(covariance);
  const contrib = values.map((lambda, k) => {
    const b = weights.reduce((s, w, i) => s + w * vectors[i]![k]!, 0);
    return b * b * Math.max(lambda, 0);
  });
  const total = contrib.reduce((s, x) => s + x, 0);
  if (!(total > 0)) return null;
  const entropy = contrib.reduce((s, x) => (x > 0 ? s - (x / total) * Math.log(x / total) : s), 0);
  return Math.exp(entropy);
}
