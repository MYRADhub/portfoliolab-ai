import { and, eq, isNull } from "drizzle-orm";
import { companies, companyFactorExposures, factors, type Db } from "@portfolio-lab/db";
import {
  annualizedVolatility,
  benchmarkRelative,
  dailyReturns,
  maxDrawdown,
  pearson,
  portfolioReturns,
  scoreCandidate,
  stress,
  type CandidateScore,
  type StressHolding,
} from "@portfolio-lab/finance";
import { AppError } from "./errors";
import { getPortfolioExposures, isFullyProfiled } from "./exposures";
import { BENCHMARK_TICKER, closesFor } from "./market-snapshot";
import { loadPortfolioWithPrices, monthsAgo, type LoadedPortfolio } from "./portfolio-data";
import { STRESS_PRESETS } from "./stress";

/** Same default size as the what-if and Discovery pages. */
export const DEFAULT_FIT_WEIGHT = 0.05;
export const MAX_FIT_WEIGHT = 0.5;
const MIN_FIT_DAYS = 60;

export interface FitStats {
  totalReturn: number;
  volatility: number;
  maxDrawdown: number;
  /** Against SPY; null without benchmark prices for the window. */
  beta: number | null;
}

export interface PortfolioFit {
  portfolio: { id: string; name: string };
  candidate: { ticker: string; name: string; sector: string | null };
  /** Share of the portfolio the candidate would take; the other holdings shrink in proportion. */
  weight: number;
  /** The candidate's current weight when it is already held, so "adding" means a larger position. */
  heldWeight: number | null;
  window: { from: string; to: string; tradingDays: number };
  /** Constant weights rebalanced daily over the last year, with and without the candidate. A backtest, not a forecast. */
  history: { before: FitStats; after: FitStats; candidate: FitStats };
  correlation: {
    withPortfolio: number;
    byHolding: { ticker: string; weight: number; correlation: number }[];
  };
  sectors: { sector: string; before: number; after: number }[];
  /** Hidden-exposure concentration before and after; null without exposure data or when already held. */
  concentration: (CandidateScore & { factorNames: Record<string, string> }) | null;
  /** Holdings that lean the same way as the candidate on at least one force, strongest overlap first. */
  overlaps: { ticker: string; factors: string[] }[];
  /** Preset scenarios, estimated impact on the portfolio before and after; empty without exposure data. */
  stress: { id: string; name: string; before: number; after: number }[];
  /** Signed exposures of each holding and the candidate, for a heatmap. */
  exposureGrid: { rows: string[]; columns: string[]; values: number[][] } | null;
}

function stats(rets: readonly number[], bench: readonly number[] | null): FitStats {
  return {
    totalReturn: rets.reduce((g, r) => g * (1 + r), 1) - 1,
    volatility: annualizedVolatility(rets),
    maxDrawdown: maxDrawdown(rets),
    beta: bench ? benchmarkRelative(rets, bench).beta : null,
  };
}

/** Everything about the portfolio that does not depend on the candidate, loaded once for several candidates. */
export interface FitContext {
  db: Db;
  sessionId: string;
  portfolioId: string;
  now: Date;
  loaded: LoadedPortfolio;
  spy: Map<string, number>;
  exposures: Awaited<ReturnType<typeof getPortfolioExposures>>;
}

export async function loadFitContext(
  db: Db,
  sessionId: string,
  portfolioId: string,
  now: Date = new Date(),
): Promise<FitContext> {
  const since = monthsAgo(now, 12);
  const loaded = await loadPortfolioWithPrices(db, sessionId, portfolioId, since);
  const spyRows = (await closesFor(db, BENCHMARK_TICKER, since)) ?? [];
  return {
    db,
    sessionId,
    portfolioId,
    now,
    loaded,
    spy: new Map(spyRows.map((r) => [r.date, r.close])),
    exposures: await getPortfolioExposures(db, sessionId, portfolioId),
  };
}

async function candidateExposures(db: Db, companyId: number) {
  const rows = await db
    .select({
      slug: factors.slug,
      magnitude: companyFactorExposures.magnitude,
      direction: companyFactorExposures.direction,
      confidence: companyFactorExposures.confidence,
    })
    .from(companyFactorExposures)
    .innerJoin(factors, eq(factors.id, companyFactorExposures.factorId))
    .where(
      and(eq(companyFactorExposures.companyId, companyId), isNull(companyFactorExposures.validTo)),
    );
  return Object.fromEntries(
    rows
      .filter((r) => r.magnitude > 0)
      .map((r) => [r.slug, { signed: r.magnitude * r.direction, confidence: r.confidence }]),
  );
}

/** How adding `ticker` at `weight` would have changed the portfolio, on prices, sectors, exposures and scenarios. */
export async function fitFor(
  ctx: FitContext,
  tickerInput: string,
  weight: number = DEFAULT_FIT_WEIGHT,
): Promise<PortfolioFit> {
  if (!(weight > 0 && weight <= MAX_FIT_WEIGHT))
    throw new AppError("bad_request", "Weight must be above 0 and at most 50%");
  const { db, loaded } = ctx;
  const ticker = tickerInput.trim().toUpperCase();
  const [c] = await db.select().from(companies).where(eq(companies.ticker, ticker));
  if (!c) throw new AppError("not_found", `Company ${ticker} not found`);

  const candRows = (await closesFor(db, ticker, loaded.since)) ?? [];
  const candMap = new Map(candRows.map((r) => [r.date, r.close]));
  const dates = loaded.dates.filter((d) => candMap.has(d));
  if (dates.length < MIN_FIT_DAYS)
    throw new AppError(
      "conflict",
      `Only ${dates.length} trading days shared by ${ticker} and the portfolio; at least ${MIN_FIT_DAYS} are needed`,
    );

  const holdingRets = loaded.series.map((s) => dailyReturns(s, dates));
  const candRets = dailyReturns(
    dates.map((d) => ({ date: d, adjClose: candMap.get(d)! })),
    dates,
  );
  const heldIndex = loaded.holdings.findIndex((h) => h.ticker === ticker);
  const beforeW = loaded.holdings.map((h) => h.weight);
  const scaled = beforeW.map((w) => w * (1 - weight));
  let afterW: number[];
  let afterRets: number[][];
  if (heldIndex >= 0) {
    afterW = scaled.map((w, i) => (i === heldIndex ? w + weight : w));
    afterRets = holdingRets;
  } else {
    afterW = [...scaled, weight];
    afterRets = [...holdingRets, candRets];
  }
  const before = portfolioReturns(beforeW, holdingRets);
  const after = portfolioReturns(afterW, afterRets);
  const benchOk = dates.every((d) => ctx.spy.has(d));
  const bench = benchOk
    ? dailyReturns(
        dates.map((d) => ({ date: d, adjClose: ctx.spy.get(d)! })),
        dates,
      )
    : null;

  // Sector weights before and after.
  const sectorW = (ws: number[], extra: { sector: string | null; w: number } | null) => {
    const m = new Map<string, number>();
    loaded.holdings.forEach((h, i) =>
      m.set(h.sector ?? "Unclassified", (m.get(h.sector ?? "Unclassified") ?? 0) + ws[i]!),
    );
    if (extra)
      m.set(extra.sector ?? "Unclassified", (m.get(extra.sector ?? "Unclassified") ?? 0) + extra.w);
    return m;
  };
  const sb = sectorW(beforeW, null);
  const sa = sectorW(
    heldIndex >= 0 ? afterW : scaled,
    heldIndex >= 0 ? null : { sector: c.sector, w: weight },
  );
  const sectors = [...new Set([...sb.keys(), ...sa.keys()])]
    .map((s) => ({ sector: s, before: sb.get(s) ?? 0, after: sa.get(s) ?? 0 }))
    .sort(
      (a, b) =>
        Math.abs(b.after - b.before) - Math.abs(a.after - a.before) ||
        a.sector.localeCompare(b.sector),
    );

  // Exposures, overlaps and scenarios need exposure data for every holding.
  const exp = ctx.exposures;
  const cand = await candidateExposures(db, c.id);
  let concentration: PortfolioFit["concentration"] = null;
  let overlaps: PortfolioFit["overlaps"] = [];
  let stressRows: PortfolioFit["stress"] = [];
  let exposureGrid: PortfolioFit["exposureGrid"] = null;
  if (exp.available && isFullyProfiled(exp)) {
    const byTicker = new Map<string, Record<string, { signed: number; confidence: number }>>();
    for (const cell of exp.cells) {
      const v = byTicker.get(cell.ticker) ?? {};
      v[cell.factor] = { signed: cell.signed, confidence: cell.confidence };
      byTicker.set(cell.ticker, v);
    }
    const factorNames = Object.fromEntries(exp.factors.map((f) => [f.slug, f.name]));
    const signedOnly = (r: Record<string, { signed: number }>) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.signed]));
    if (heldIndex < 0 && Object.keys(cand).length) {
      concentration = {
        ...scoreCandidate(
          exp.holdings.map((h) => ({
            ticker: h.ticker,
            weight: h.weight,
            sector: h.sector,
            exposures: signedOnly(byTicker.get(h.ticker) ?? {}),
          })),
          { ticker, sector: c.sector, exposures: signedOnly(cand) },
          weight,
        ),
        factorNames: { ...factorNames },
      };
    }
    overlaps = loaded.holdings
      .filter((h) => h.ticker !== ticker)
      .map((h) => {
        const mine = byTicker.get(h.ticker) ?? {};
        const shared = Object.entries(cand)
          .filter(([f, e]) => mine[f] && Math.sign(mine[f]!.signed) === Math.sign(e.signed))
          .sort((a, b) => Math.abs(b[1].signed) - Math.abs(a[1].signed))
          .map(([f]) => factorNames[f] ?? f);
        return { ticker: h.ticker, factors: shared };
      })
      .filter((o) => o.factors.length > 0)
      .sort((a, b) => b.factors.length - a.factors.length || a.ticker.localeCompare(b.ticker));

    const holdingsFor = (ws: number[], withCandidate: boolean): StressHolding[] => [
      ...loaded.holdings.map((h, i) => ({
        ticker: h.ticker,
        weight: ws[i]!,
        exposures: byTicker.get(h.ticker) ?? {},
      })),
      ...(withCandidate ? [{ ticker, weight, exposures: cand }] : []),
    ];
    const hBefore = holdingsFor(beforeW, false);
    const hAfter = heldIndex >= 0 ? holdingsFor(afterW, false) : holdingsFor(scaled, true);
    stressRows = STRESS_PRESETS.map((p) => ({
      id: p.id,
      name: p.name,
      before: stress(hBefore, p.shocks).portfolioImpact,
      after: stress(hAfter, p.shocks).portfolioImpact,
    }));

    const columns = [
      ...new Set([...exp.cells.filter((x) => x.signed).map((x) => x.factor), ...Object.keys(cand)]),
    ].sort();
    const rows = [...loaded.holdings.map((h) => h.ticker), ...(heldIndex >= 0 ? [] : [ticker])];
    exposureGrid = {
      rows,
      columns,
      values: rows.map((t) => {
        const e = t === ticker ? cand : (byTicker.get(t) ?? {});
        return columns.map((f) => e[f]?.signed ?? 0);
      }),
    };
  }

  return {
    portfolio: loaded.portfolio,
    candidate: { ticker, name: c.name, sector: c.sector },
    weight,
    heldWeight: heldIndex >= 0 ? beforeW[heldIndex]! : null,
    window: { from: dates[0]!, to: dates.at(-1)!, tradingDays: dates.length },
    history: {
      before: stats(before, bench),
      after: stats(after, bench),
      candidate: stats(candRets, bench),
    },
    correlation: {
      withPortfolio: pearson(candRets, before),
      byHolding: loaded.holdings
        .map((h, i) => ({
          ticker: h.ticker,
          weight: h.weight,
          correlation: pearson(candRets, holdingRets[i]!),
        }))
        .sort((a, b) => b.correlation - a.correlation || a.ticker.localeCompare(b.ticker)),
    },
    sectors,
    concentration,
    overlaps,
    stress: stressRows,
    exposureGrid,
  };
}

export async function getPortfolioFit(
  db: Db,
  sessionId: string,
  portfolioId: string,
  ticker: string,
  weight: number = DEFAULT_FIT_WEIGHT,
  now: Date = new Date(),
): Promise<PortfolioFit> {
  return fitFor(await loadFitContext(db, sessionId, portfolioId, now), ticker, weight);
}
