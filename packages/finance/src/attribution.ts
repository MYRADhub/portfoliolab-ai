export interface Contribution {
  index: number;
  weight: number;
  assetReturn: number;
  /** weight * assetReturn, as a fraction of portfolio value (0.01 is one percentage point). */
  contribution: number;
}

/**
 * Each holding's contribution to the portfolio return on day `t`, under constant target weights. The
 * contributions sum exactly to the portfolio's return that day.
 */
export function dayContributions(
  weights: readonly number[],
  returnsByAsset: readonly (readonly number[])[],
  t: number,
): Contribution[] {
  if (weights.length !== returnsByAsset.length) throw new Error("weights/returns length mismatch");
  return weights.map((weight, index) => {
    const r = returnsByAsset[index]?.[t];
    if (r === undefined) throw new Error(`no return for asset ${index} on day ${t}`);
    return { index, weight, assetReturn: r, contribution: weight * r };
  });
}

export interface GroupContribution {
  group: string;
  contribution: number;
  /** Contribution divided by the total move; negative when the group moved against the portfolio. Null if the total is too small to divide by. */
  share: number | null;
}

/** Below this absolute total (5 basis points) a "share of the move" is not meaningful. */
export const MIN_TOTAL_FOR_SHARE = 0.0005;

/** Sums contributions by group and expresses each as a share of the total move, largest effect first. */
export function groupContributions(
  items: readonly { group: string; contribution: number }[],
  minTotal: number = MIN_TOTAL_FOR_SHARE,
): { total: number; groups: GroupContribution[] } {
  const sums = new Map<string, number>();
  for (const i of items) sums.set(i.group, (sums.get(i.group) ?? 0) + i.contribution);
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  const groups = [...sums.entries()]
    .map(([group, contribution]) => ({
      group,
      contribution,
      share: Math.abs(total) >= minTotal ? contribution / total : null,
    }))
    .sort(
      (a, b) =>
        Math.abs(b.contribution) - Math.abs(a.contribution) || a.group.localeCompare(b.group),
    );
  return { total, groups };
}
