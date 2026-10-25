import { and, asc, eq, gte } from "drizzle-orm";
import { benchmarkPrices, type Db } from "@portfolio-lab/db";
import {
  annualizedReturn,
  annualizedVolatility,
  benchmarkRelative,
  cumulativeGrowth,
  dailyReturns,
  maxDrawdown,
  pearson,
  portfolioReturns,
  sharpeRatio,
} from "@portfolio-lab/finance";
import { pct } from "@/lib/format";
import { AppError } from "./errors";
import { getPortfolioExposures } from "./exposures";
import { loadPortfolioWithPrices, monthsAgo } from "./portfolio-data";
import { BENCHMARK_SYMBOL } from "./benchmark";

export const COMPARE_YEARS = 3;

export interface CompareSide {
  id: string;
  name: string;
  holdings: number;
  annualReturn: number;
  volatility: number;
  maxDrawdown: number;
  sharpe: number;
  effectiveSectors: number | null;
  effectiveFactors: number | null;
  topForce: { name: string; share: number } | null;
  beta: number | null;
}

export interface Comparison {
  a: CompareSide;
  b: CompareSide;
  window: { from: string; to: string; tradingDays: number };
  /** Share of money both portfolios hold in the same companies (sum of the smaller weight of each shared company). */
  overlap: { sharedWeight: number; shared: { ticker: string; a: number; b: number }[] };
  /** Correlation of the two portfolios' daily returns. Null if one never moves. */
  correlation: number | null;
  curves: { dates: string[]; a: number[]; b: number[] };
  /** Plain-language sentences about the biggest differences, computed from the figures above. */
  differences: string[];
}

/** Pure: the sentences that describe how B differs from A. Exported so they can be tested without a database. */
export function describeDifferences(
  c: Pick<Comparison, "a" | "b" | "overlap" | "correlation">,
): string[] {
  const { a, b } = c;
  const out: string[] = [];
  const pts = (x: number) => `${Math.abs(x * 100).toFixed(1)} points`;
  const ret = b.annualReturn - a.annualReturn;
  const vol = b.volatility - a.volatility;
  out.push(
    `Over this period ${b.name} returned ${pts(ret)} a year ${ret >= 0 ? "more" : "less"} than ${a.name}, with ${pts(vol)} ${vol >= 0 ? "more" : "less"} volatility.`,
  );
  const dd = b.maxDrawdown - a.maxDrawdown;
  if (Math.abs(dd) >= 0.01)
    out.push(
      `${dd < 0 ? b.name : a.name}'s worst fall was deeper: ${pct(Math.min(a.maxDrawdown, b.maxDrawdown), 1)} against ${pct(Math.max(a.maxDrawdown, b.maxDrawdown), 1)}.`,
    );
  if (a.effectiveFactors !== null && b.effectiveFactors !== null) {
    const f = b.effectiveFactors - a.effectiveFactors;
    out.push(
      Math.abs(f) < 0.3
        ? `Both depend on about the same number of independent economic forces (${a.effectiveFactors.toFixed(1)} and ${b.effectiveFactors.toFixed(1)}).`
        : `${f > 0 ? b.name : a.name} is spread across more economic forces: ${Math.max(a.effectiveFactors, b.effectiveFactors).toFixed(1)} against ${Math.min(a.effectiveFactors, b.effectiveFactors).toFixed(1)}.`,
    );
  }
  if (a.topForce && b.topForce)
    out.push(
      a.topForce.name === b.topForce.name
        ? `Both lean most on the same force: ${a.topForce.name} (${pct(a.topForce.share, 0)} and ${pct(b.topForce.share, 0)} of exposure).`
        : `${a.name} leans most on ${a.topForce.name} (${pct(a.topForce.share, 0)}); ${b.name} on ${b.topForce.name} (${pct(b.topForce.share, 0)}).`,
    );
  if (a.beta !== null && b.beta !== null && Math.abs(b.beta - a.beta) >= 0.1)
    out.push(
      `${b.beta > a.beta ? b.name : a.name} moves more with the market: beta ${Math.max(a.beta, b.beta).toFixed(2)} against ${Math.min(a.beta, b.beta).toFixed(2)}.`,
    );
  out.push(
    c.overlap.sharedWeight < 0.02
      ? "They share almost no holdings."
      : `${pct(c.overlap.sharedWeight, 0)} of the money sits in companies both hold.`,
  );
  if (c.correlation !== null)
    out.push(
      `Their daily returns have moved ${c.correlation >= 0.9 ? "almost in lockstep" : c.correlation >= 0.6 ? "largely together" : "fairly independently"} (correlation ${c.correlation.toFixed(2)}).`,
    );
  return out;
}

/** Side-by-side comparison of two session-owned portfolios over their shared price history. */
export async function comparePortfolios(
  db: Db,
  sessionId: string,
  idA: string,
  idB: string,
  opts: { now?: Date } = {},
): Promise<Comparison> {
  if (idA === idB) throw new AppError("bad_request", "Choose two different portfolios");
  const { now = new Date() } = opts;
  const since = monthsAgo(now, COMPARE_YEARS * 12);
  const [la, lb] = [
    await loadPortfolioWithPrices(db, sessionId, idA, since),
    await loadPortfolioWithPrices(db, sessionId, idB, since),
  ];
  const inB = new Set(lb.dates);
  const dates = la.dates.filter((d) => inB.has(d));
  if (dates.length < 60)
    throw new AppError("conflict", "These portfolios share too little price history to compare");

  const retsOf = (l: typeof la) =>
    portfolioReturns(
      l.holdings.map((h) => h.weight),
      l.series.map((s) => dailyReturns(s, dates)),
    );
  const ra = retsOf(la);
  const rb = retsOf(lb);

  const bench = await db
    .select({ date: benchmarkPrices.date, adjClose: benchmarkPrices.adjClose })
    .from(benchmarkPrices)
    .where(and(eq(benchmarkPrices.symbol, BENCHMARK_SYMBOL), gte(benchmarkPrices.date, dates[0]!)))
    .orderBy(asc(benchmarkPrices.date));
  const have = new Set(bench.map((x) => x.date));
  const benchRets = dates.every((d) => have.has(d)) ? dailyReturns(bench, dates) : null;

  const side = async (l: typeof la, r: number[]): Promise<CompareSide> => {
    const x = await getPortfolioExposures(db, sessionId, l.portfolio.id);
    return {
      id: l.portfolio.id,
      name: l.portfolio.name,
      holdings: l.holdings.length,
      annualReturn: annualizedReturn(r),
      volatility: annualizedVolatility(r),
      maxDrawdown: maxDrawdown(r),
      sharpe: sharpeRatio(r, 0),
      effectiveSectors: x.available ? x.concentration.effectiveSectors : null,
      effectiveFactors: x.available ? x.concentration.effectiveFactors : null,
      topForce:
        x.available && x.factors[0] ? { name: x.factors[0].name, share: x.factors[0].share } : null,
      beta: benchRets ? benchmarkRelative(r, benchRets).beta : null,
    };
  };
  const [a, b] = [await side(la, ra), await side(lb, rb)];

  const wa = new Map(la.holdings.map((h) => [h.ticker, h.weight]));
  const shared = lb.holdings
    .filter((h) => wa.has(h.ticker))
    .map((h) => ({ ticker: h.ticker, a: wa.get(h.ticker)!, b: h.weight }))
    .sort((x, y) => Math.min(y.a, y.b) - Math.min(x.a, x.b) || x.ticker.localeCompare(y.ticker));
  let correlation: number | null = null;
  try {
    correlation = pearson(ra, rb);
  } catch {
    correlation = null;
  }
  const result: Comparison = {
    a,
    b,
    window: { from: dates[0]!, to: dates.at(-1)!, tradingDays: ra.length },
    overlap: { sharedWeight: shared.reduce((acc, s) => acc + Math.min(s.a, s.b), 0), shared },
    correlation,
    curves: {
      dates,
      a: cumulativeGrowth(ra).map((g) => g * 100),
      b: cumulativeGrowth(rb).map((g) => g * 100),
    },
    differences: [],
  };
  result.differences = describeDifferences(result);
  return result;
}
