export interface PricePoint {
  date: string; // YYYY-MM-DD
  adjClose: number;
}

export type PriceSeries = readonly PricePoint[];

/** Dates present in every series, sorted ascending. Returns can only be compared on this window. */
export function commonDates(seriesList: readonly PriceSeries[]): string[] {
  if (seriesList.length === 0) return [];
  const [first, ...rest] = seriesList;
  const sets = rest.map((s) => new Set(s.map((p) => p.date)));
  return first!
    .map((p) => p.date)
    .filter((d) => sets.every((set) => set.has(d)))
    .sort();
}

/** Simple daily returns r_t = P_t / P_{t-1} - 1 over the given consecutive dates. */
export function dailyReturns(series: PriceSeries, dates: readonly string[]): number[] {
  const byDate = new Map(series.map((p) => [p.date, p.adjClose]));
  const out: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const prev = byDate.get(dates[i - 1]!);
    const cur = byDate.get(dates[i]!);
    if (prev === undefined || cur === undefined || prev <= 0) {
      throw new Error(`missing or invalid price around ${dates[i]}`);
    }
    out.push(cur / prev - 1);
  }
  return out;
}

/**
 * Portfolio daily returns with constant target weights (rebalanced daily).
 * weights and returnsByAsset must be aligned by index.
 */
export function portfolioReturns(
  weights: readonly number[],
  returnsByAsset: readonly (readonly number[])[],
): number[] {
  if (weights.length !== returnsByAsset.length) throw new Error("weights/returns length mismatch");
  const n = returnsByAsset[0]?.length ?? 0;
  if (returnsByAsset.some((r) => r.length !== n)) throw new Error("return series length mismatch");
  return Array.from({ length: n }, (_, t) =>
    weights.reduce((acc, w, i) => acc + w * returnsByAsset[i]![t]!, 0),
  );
}
