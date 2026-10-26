import { mulberry32 } from "./eventstudy";

/** One company scored twice: by the AI draft and by a person who did not see the draft. Signed scores -3..+3 by force. */
export interface RatedCompany {
  ticker: string;
  ai: Readonly<Record<string, number>>;
  human: Readonly<Record<string, number>>;
}

/** The signed exposure scale: -3 (hurt a lot when the force rises) to +3 (helped a lot). */
export const SCORE_SCALE = [-3, -2, -1, 0, 1, 2, 3] as const;

/**
 * Cohen's kappa with quadratic weights: agreement beyond what chance would give, where a near miss (2 against 3)
 * counts as partial agreement and a sign error (-2 against +2) counts as a large disagreement. 1 is perfect, 0 is
 * chance. Null when every pair sits in one category, since chance agreement is then 1 and kappa is undefined.
 */
export function weightedKappa(
  pairs: readonly (readonly [number, number])[],
  scale: readonly number[] = SCORE_SCALE,
): number | null {
  const k = scale.length;
  if (pairs.length === 0 || k < 2) return null;
  const idx = new Map(scale.map((v, i) => [v, i]));
  const obs = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const ra = new Array<number>(k).fill(0);
  const rb = new Array<number>(k).fill(0);
  for (const [a, b] of pairs) {
    const i = idx.get(a);
    const j = idx.get(b);
    if (i === undefined || j === undefined) throw new Error(`score off the scale: ${a}, ${b}`);
    obs[i]![j]!++;
    ra[i]!++;
    rb[j]!++;
  }
  const n = pairs.length;
  let o = 0;
  let e = 0;
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++) {
      const w = (i - j) ** 2 / (k - 1) ** 2;
      o += (w * obs[i]![j]!) / n;
      e += (w * ra[i]! * rb[j]!) / (n * n);
    }
  return e === 0 ? null : 1 - o / e;
}

/** Plain Cohen's kappa for a yes/no judgement. Null when chance agreement is 1. */
export function binaryKappa(pairs: readonly (readonly [boolean, boolean])[]): number | null {
  const n = pairs.length;
  if (n === 0) return null;
  const agree = pairs.filter(([a, b]) => a === b).length / n;
  const pa = pairs.filter(([a]) => a).length / n;
  const pb = pairs.filter(([, b]) => b).length / n;
  const chance = pa * pb + (1 - pa) * (1 - pb);
  return chance === 1 ? null : (agree - chance) / (1 - chance);
}

export interface ForceAgreement {
  slug: string;
  /** Companies the AI and the person each marked as exposed to this force. */
  aiExposed: number;
  humanExposed: number;
  /** Share of companies where both agree on whether the force matters at all. */
  presenceAgreement: number;
  meanAbsDiff: number;
}

export interface RaterAgreement {
  companies: number;
  /** Company-force cells compared, including the ones both left at zero. */
  cells: number;
  /** Share of cells with the identical score. Inflated by the many cells both leave at zero; read kappa instead. */
  exact: number;
  weightedKappa: number | null;
  /** 95% interval from resampling companies, so forces of one company stay together. */
  kappaInterval: [number, number] | null;
  /** Kappa for "does this force matter for this company at all". */
  presenceKappa: number | null;
  /** Cells where both marked an exposure, and the share of those where the direction matches. */
  bothExposed: number;
  signAgreement: number | null;
  /** Mean absolute difference in signed score over all cells. */
  meanAbsDiff: number;
  /** Average number of forces marked per company. Shows whether the AI over- or under-assigns. */
  aiForcesPerCompany: number;
  humanForcesPerCompany: number;
  byForce: ForceAgreement[];
}

function cellsOf(rated: readonly RatedCompany[], forces: readonly string[]): [number, number][] {
  return rated.flatMap((c) =>
    forces.map((f) => [c.ai[f] ?? 0, c.human[f] ?? 0] as [number, number]),
  );
}

/**
 * How far the AI drafts agree with blind human scores, over every company-force cell (an absent force is 0).
 * The interval resamples companies with a seeded generator so the same data always gives the same interval.
 */
export function raterAgreement(
  rated: readonly RatedCompany[],
  forces: readonly string[],
  opts: { seed?: number; resamples?: number } = {},
): RaterAgreement {
  const { seed = 1, resamples = 2000 } = opts;
  const cells = cellsOf(rated, forces);
  const n = cells.length;
  const both = cells.filter(([a, b]) => a !== 0 && b !== 0);
  const exposedCount = (side: 0 | 1) => cells.filter((c) => c[side] !== 0).length;

  let kappaInterval: [number, number] | null = null;
  const kappa = weightedKappa(cells);
  if (kappa !== null && rated.length >= 2) {
    const rand = mulberry32(seed);
    const draws: number[] = [];
    for (let r = 0; r < resamples; r++) {
      const sample = Array.from(
        { length: rated.length },
        () => rated[Math.floor(rand() * rated.length)]!,
      );
      const k = weightedKappa(cellsOf(sample, forces));
      if (k !== null) draws.push(k);
    }
    draws.sort((a, b) => a - b);
    if (draws.length > 0)
      kappaInterval = [
        draws[Math.floor(0.025 * (draws.length - 1))]!,
        draws[Math.ceil(0.975 * (draws.length - 1))]!,
      ];
  }

  return {
    companies: rated.length,
    cells: n,
    exact: n ? cells.filter(([a, b]) => a === b).length / n : 0,
    weightedKappa: kappa,
    kappaInterval,
    presenceKappa: binaryKappa(cells.map(([a, b]) => [a !== 0, b !== 0])),
    bothExposed: both.length,
    signAgreement: both.length
      ? both.filter(([a, b]) => Math.sign(a) === Math.sign(b)).length / both.length
      : null,
    meanAbsDiff: n ? cells.reduce((s, [a, b]) => s + Math.abs(a - b), 0) / n : 0,
    aiForcesPerCompany: rated.length ? exposedCount(0) / rated.length : 0,
    humanForcesPerCompany: rated.length ? exposedCount(1) / rated.length : 0,
    byForce: forces.map((f) => {
      const fc = cellsOf(rated, [f]);
      const m = fc.length || 1;
      return {
        slug: f,
        aiExposed: fc.filter(([a]) => a !== 0).length,
        humanExposed: fc.filter(([, b]) => b !== 0).length,
        presenceAgreement: fc.filter(([a, b]) => (a !== 0) === (b !== 0)).length / m,
        meanAbsDiff: fc.reduce((s, [a, b]) => s + Math.abs(a - b), 0) / m,
      };
    }),
  };
}
