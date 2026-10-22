export interface FiscalYear {
  fiscalYear: number;
  revenue: number | null;
  netIncome: number | null;
  operatingIncome: number | null;
  epsDiluted: number | null;
  operatingCashFlow: number | null;
  totalAssets: number | null;
  equity: number | null;
}

export interface FundamentalRatios {
  /** Fiscal year the ratios refer to. */
  fiscalYear: number;
  /** Revenue growth over the previous fiscal year; null if that year is missing. */
  revenueGrowth: number | null;
  netMargin: number | null;
  operatingMargin: number | null;
  /** Net income over year-end equity (not average equity). Null when equity is not positive. */
  returnOnEquity: number | null;
  /** Price over diluted earnings per share, for the latest fiscal year. Null when earnings are not positive. */
  priceToEarnings: number | null;
}

const ratio = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : a / b;

/** Ratios from the latest fiscal year in `years` (any order). Null when there are no years. */
export function fundamentalRatios(
  years: readonly FiscalYear[],
  price: number | null,
): FundamentalRatios | null {
  if (years.length === 0) return null;
  const sorted = [...years].sort((a, b) => b.fiscalYear - a.fiscalYear);
  const cur = sorted[0]!;
  const prev = sorted.find((y) => y.fiscalYear === cur.fiscalYear - 1);
  const growth = ratio(cur.revenue, prev?.revenue ?? null);
  return {
    fiscalYear: cur.fiscalYear,
    revenueGrowth: growth === null ? null : growth - 1,
    netMargin: ratio(cur.netIncome, cur.revenue),
    operatingMargin: ratio(cur.operatingIncome, cur.revenue),
    returnOnEquity: cur.equity !== null && cur.equity > 0 ? ratio(cur.netIncome, cur.equity) : null,
    priceToEarnings:
      price !== null && cur.epsDiluted !== null && cur.epsDiluted > 0
        ? price / cur.epsDiluted
        : null,
  };
}
