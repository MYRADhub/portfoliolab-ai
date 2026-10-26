export interface GoldCandidate {
  ticker: string;
  sector: string | null;
  /** Issuer id (SEC CIK) so that two share classes of one company count once. Falls back to the ticker. */
  issuer?: string | null;
  /** Median daily traded value over the last year, a stand-in for size and how well known a company is. */
  dollarVolume: number;
}

/**
 * The gold set: the `perSector` most traded companies in every sector, so a hand review covers each part of the
 * index evenly. Only the most traded share class of an issuer is kept. Ties break by ticker so the pick is
 * reproducible. Companies without a sector or trading data are left out.
 */
export function pickGoldSet(rows: readonly GoldCandidate[], perSector = 3): string[] {
  if (!Number.isInteger(perSector) || perSector < 1)
    throw new Error("perSector must be a positive integer");
  const order = (a: GoldCandidate, b: GoldCandidate) =>
    b.dollarVolume - a.dollarVolume || a.ticker.localeCompare(b.ticker);
  const seen = new Set<string>();
  const by = new Map<string, GoldCandidate[]>();
  for (const r of [...rows].sort(order)) {
    if (!r.sector || !(r.dollarVolume > 0)) continue;
    const issuer = r.issuer ?? r.ticker;
    if (seen.has(issuer)) continue;
    seen.add(issuer);
    by.set(r.sector, [...(by.get(r.sector) ?? []), r]);
  }
  return [...by.keys()].sort().flatMap((s) =>
    by
      .get(s)!
      .sort((a, b) => b.dollarVolume - a.dollarVolume || a.ticker.localeCompare(b.ticker))
      .slice(0, perSector)
      .map((r) => r.ticker),
  );
}
