import { and, eq } from "drizzle-orm";
import { companies, factors, holdings, portfolios, type Db } from "@portfolio-lab/db";
import {
  attributeToFactors,
  crossSectionFit,
  mean,
  stdev,
  type FactorAttribution,
} from "@portfolio-lab/finance";
import { AppError } from "./errors";
import { loadMarket } from "./events";
import { exposureMap } from "./research";

export const FORCE_DAYS = 252;
/** Fewer stocks than this on a day and the day's cross-section is not fitted. */
export const MIN_UNIVERSE = 60;
const RIDGE = 1;

export interface ForceRow {
  slug: string;
  name: string;
  /** Sum over the window of the force's daily return, in percentage points of return per exposure point. */
  cumulative: number;
  /** t-statistic of the mean daily return against zero. */
  t: number | null;
  /** The portfolio's net exposure to this force (weights times scores). */
  portfolioNet: number;
  /** Contribution to the portfolio's summed daily return: net exposure times the force's return, summed over days. */
  contribution: number;
}

export type ForceReturns =
  | { available: false; reason: "missing_exposures" | "thin_universe"; missingTickers: string[] }
  | {
      available: true;
      portfolio: { id: string; name: string };
      window: { from: string; to: string; days: number };
      /** Stocks in the cross-section on an average day, and the forces estimated. */
      universe: { stocks: number; forces: number };
      /** Average daily adjusted R-squared: how much of the day-to-day differences between stocks each model explains. */
      fit: { exposures: number; sectors: number; daysExposuresBetter: number };
      forces: ForceRow[];
      attribution: Pick<FactorAttribution, "market" | "residual" | "total"> & { forces: number };
    };

/**
 * Estimates what each hidden force did, from real prices: every day, regress all profiled stocks' returns on their
 * exposure scores; the coefficients are the forces' daily returns. The same regression with sector labels instead of
 * exposure scores is the yardstick for "do exposures describe the market better than sectors do?". The portfolio's
 * return over the window is then split into force contributions, a market-wide part and a residual that adds up exactly.
 */
export async function getForceReturns(
  db: Db,
  sessionId: string,
  portfolioId: string,
  opts: { now?: Date; days?: number } = {},
): Promise<ForceReturns> {
  const { now = new Date(), days = FORCE_DAYS } = opts;
  const [p] = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.sessionId, sessionId)));
  if (!p) throw new AppError("not_found", "Portfolio not found");

  const held = await db
    .select({ id: companies.id, ticker: companies.ticker, weight: holdings.weight })
    .from(holdings)
    .innerJoin(companies, eq(companies.id, holdings.companyId))
    .where(eq(holdings.portfolioId, portfolioId));
  const profiles = await exposureMap(db);
  const missingTickers = held.filter((h) => !profiles.has(h.id)).map((h) => h.ticker);
  if (missingTickers.length)
    return { available: false, reason: "missing_exposures", missingTickers };

  const all = await db.select().from(companies);
  const universe = all.filter((c) => profiles.has(c.id));
  if (universe.length < MIN_UNIVERSE)
    return { available: false, reason: "thin_universe", missingTickers: [] };

  const slugs = [...new Set(universe.flatMap((c) => Object.keys(profiles.get(c.id)!)))].sort();
  const forceNames = new Map((await db.select().from(factors)).map((f) => [f.slug, f.name]));
  const loadingOf = (id: number) => slugs.map((s) => profiles.get(id)![s] ?? 0);
  const sectors = [...new Set(universe.map((c) => c.sector ?? "Unclassified"))].sort().slice(1);
  const sectorOf = (c: (typeof universe)[number]) =>
    sectors.map((s) => ((c.sector ?? "Unclassified") === s ? 1 : 0));

  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - Math.ceil(days * 1.5 + 10) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const market = await loadMarket(db, from, to);
  const dates = [...market.count.entries()]
    .filter(([, c]) => c >= MIN_UNIVERSE)
    .map(([d]) => d)
    .sort()
    .slice(-days);

  const heldLoadings = held.map((h) => loadingOf(h.id));
  const series: number[][] = slugs.map(() => []);
  const daily: { intercept: number; coefficients: number[]; holdingReturns: number[] }[] = [];
  const r2Exposure: number[] = [];
  const r2Sector: number[] = [];
  let better = 0;
  const sizes: number[] = [];
  for (const date of dates) {
    const X: number[][] = [];
    const S: number[][] = [];
    const y: number[] = [];
    for (const c of universe) {
      const r = market.returns.get(c.ticker)?.get(date);
      if (r === undefined) continue;
      X.push(loadingOf(c.id));
      S.push(sectorOf(c));
      y.push(r);
    }
    const fit = crossSectionFit(X, y, RIDGE);
    const hr = held.map((h) => market.returns.get(h.ticker)?.get(date));
    if (!fit || hr.some((r) => r === undefined)) continue;
    const sector = crossSectionFit(S, y, 1e-6);
    daily.push({
      intercept: fit.intercept,
      coefficients: fit.coefficients,
      holdingReturns: hr as number[],
    });
    fit.coefficients.forEach((c, j) => series[j]!.push(c));
    r2Exposure.push(fit.adjustedR2);
    if (sector) {
      r2Sector.push(sector.adjustedR2);
      if (fit.adjustedR2 > sector.adjustedR2) better++;
    }
    sizes.push(fit.n);
  }
  if (daily.length < 20) return { available: false, reason: "thin_universe", missingTickers: [] };

  const att = attributeToFactors(
    held.map((h) => h.weight),
    heldLoadings,
    daily,
  );
  const wsum = held.reduce((s, h) => s + h.weight, 0);
  const rows: ForceRow[] = slugs.map((slug, j) => {
    const sd = stdev(series[j]!);
    return {
      slug,
      name: forceNames.get(slug) ?? slug,
      cumulative: series[j]!.reduce((a, b) => a + b, 0),
      t: sd > 0 ? mean(series[j]!) / (sd / Math.sqrt(series[j]!.length)) : null,
      portfolioNet: held.reduce((s, h, i) => s + (h.weight / wsum) * heldLoadings[i]![j]!, 0),
      contribution: att.byFactor[j]!,
    };
  });
  return {
    available: true,
    portfolio: { id: p.id, name: p.name },
    window: { from: dates[0]!, to: dates.at(-1)!, days: daily.length },
    universe: { stocks: Math.round(mean(sizes)), forces: slugs.length },
    fit: {
      exposures: mean(r2Exposure),
      sectors: r2Sector.length ? mean(r2Sector) : 0,
      daysExposuresBetter: r2Sector.length ? better / r2Sector.length : 0,
    },
    forces: rows.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)),
    attribution: {
      forces: att.byFactor.reduce((a, b) => a + b, 0),
      market: att.market,
      residual: att.residual,
      total: att.total,
    },
  };
}
