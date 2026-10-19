export interface WeightInput {
  ticker: string;
  weight: number;
}

const EPS = 1e-6;

export type WeightIssue =
  | { kind: "empty" }
  | { kind: "duplicate"; ticker: string }
  | { kind: "non_positive"; ticker: string }
  | { kind: "sum"; sum: number };

/** Validates weights as fractions that must sum to 1 within tolerance. */
export function validateWeights(items: readonly WeightInput[]): WeightIssue[] {
  if (items.length === 0) return [{ kind: "empty" }];
  const issues: WeightIssue[] = [];
  const seen = new Set<string>();
  for (const { ticker, weight } of items) {
    if (seen.has(ticker)) issues.push({ kind: "duplicate", ticker });
    seen.add(ticker);
    if (!(weight > 0)) issues.push({ kind: "non_positive", ticker });
  }
  const sum = items.reduce((a, i) => a + i.weight, 0);
  if (Math.abs(sum - 1) > 1e-4) issues.push({ kind: "sum", sum });
  return issues;
}

export function normalizeWeights<T extends { weight: number }>(items: readonly T[]): T[] {
  const sum = items.reduce((a, i) => a + i.weight, 0);
  if (!(sum > EPS)) throw new Error("cannot normalize weights that sum to zero");
  return items.map((i) => ({ ...i, weight: i.weight / sum }));
}

/** Herfindahl-Hirschman index of weights and its inverse, the effective number of holdings. */
export function concentration(weights: readonly number[]): { hhi: number; effectiveN: number } {
  const hhi = weights.reduce((a, w) => a + w * w, 0);
  return { hhi, effectiveN: 1 / hhi };
}

export function sectorAllocation(
  holdings: readonly { sector: string | null; weight: number }[],
): { sector: string; weight: number }[] {
  const acc = new Map<string, number>();
  for (const h of holdings) {
    const key = h.sector ?? "Unclassified";
    acc.set(key, (acc.get(key) ?? 0) + h.weight);
  }
  return [...acc.entries()]
    .map(([sector, weight]) => ({ sector, weight }))
    .sort((a, b) => b.weight - a.weight);
}
