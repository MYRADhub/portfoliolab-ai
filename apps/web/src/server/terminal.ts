import type { Db } from "@portfolio-lab/db";
import {
  annualizedVolatility,
  bestWorstDays,
  correlationMatrix,
  cumulativeGrowth,
  dailyReturns,
  drawdownEpisodes,
  expectedShortfall,
  histogram,
  historicalVar,
  maxDrawdown,
  monthlyReturns,
  periodReturn,
  portfolioReturns,
  riskContributions,
  rollingVolatility,
  sharpeRatio,
  topDays,
  upDayShare,
  type DayExtreme,
  type DrawdownEpisode,
  type HistogramBin,
  type MonthReturn,
} from "@portfolio-lab/finance";
import { getPortfolioExposures } from "./exposures";
import { loadPortfolioWithPrices, monthsAgo } from "./portfolio-data";
import { getMarketRadar } from "./radar";

export const TERMINAL_MONTHS = 24;
export const SPARKLINE_DAYS = 60;
export const ROLLING_VOL_WINDOW = 21;

export interface TerminalHolding {
  ticker: string;
  name: string;
  sector: string;
  weight: number;
  /** Last adjusted close. */
  price: number;
  d1: number | null;
  d5: number | null;
  m1: number | null;
  /** Share of portfolio variance this holding accounts for; compare with its weight. */
  riskShare: number;
  /** Last 60 closes rebased to 100. */
  sparkline: number[];
}

export interface Terminal {
  portfolio: { id: string; name: string };
  asOf: string;
  window: { from: string; to: string; tradingDays: number };
  /** Portfolio index, 100 at the start of the window. */
  index: { value: number; dayChange: number };
  equity: { date: string; value: number }[];
  performance: { label: string; value: number | null }[];
  holdings: TerminalHolding[];
  risk: {
    volatility: number;
    sharpe: number;
    maxDrawdown: number;
    var95: number;
    var99: number;
    expectedShortfall95: number;
    best: { date: string; value: number };
    worst: { date: string; value: number };
    upDayShare: number;
  };
  /** The five best and worst single days. */
  extremes: { best: DayExtreme[]; worst: DayExtreme[] };
  rollingVolatility: { date: string; value: number }[];
  histogram: HistogramBin[];
  monthly: MonthReturn[];
  drawdowns: DrawdownEpisode[];
  correlation: {
    average: number;
    topPairs: { a: string; b: string; correlation: number }[];
  } | null;
  news: { title: string; url: string; score: number; tickers: string[]; class: string | null }[];
  exposures:
    | { available: false; reason: string }
    | {
        available: true;
        effectiveFactors: number | null;
        effectiveSectors: number;
        topFactors: { name: string; net: number; share: number }[];
      };
}

/** Everything the Terminal page shows, computed from the same tested functions used elsewhere in the app. */
export async function getTerminal(
  db: Db,
  sessionId: string,
  portfolioId: string,
  opts: { now?: Date } = {},
): Promise<Terminal> {
  const { now = new Date() } = opts;
  const loaded = await loadPortfolioWithPrices(
    db,
    sessionId,
    portfolioId,
    monthsAgo(now, TERMINAL_MONTHS),
  );
  const { holdings: hs, series, dates } = loaded;
  const returnDates = dates.slice(1);
  const byAsset = series.map((s) => dailyReturns(s, dates));
  const weights = hs.map((h) => h.weight);
  const returns = portfolioReturns(weights, byAsset);
  const growth = cumulativeGrowth(returns);
  const equity = dates.map((date, i) => ({ date, value: growth[i]! * 100 }));
  const last = returns.length - 1;

  // Year to date: from the last trading day of the previous year, when the window reaches back that far.
  const year = dates.at(-1)!.slice(0, 4);
  const prevYearEnd = dates.reduce((idx, d, i) => (d < `${year}-01-01` ? i : idx), -1);
  const ytd = prevYearEnd >= 0 ? growth.at(-1)! / growth[prevYearEnd]! - 1 : null;

  const perf: { label: string; value: number | null }[] = [
    { label: "1 day", value: periodReturn(returns, 1) },
    { label: "1 week", value: periodReturn(returns, 5) },
    { label: "1 month", value: periodReturn(returns, 21) },
    { label: "3 months", value: periodReturn(returns, 63) },
    { label: "6 months", value: periodReturn(returns, 126) },
    { label: "Year to date", value: ytd },
    { label: "1 year", value: periodReturn(returns, 252) },
    { label: "Whole window", value: growth.at(-1)! - 1 },
  ];

  const rc = riskContributions(weights, byAsset);
  const closeOn = new Map(series.map((s, i) => [i, new Map(s.map((p) => [p.date, p.adjClose]))]));
  const holdingsOut: TerminalHolding[] = hs
    .map((h, i) => {
      const closes = dates.map((d) => closeOn.get(i)!.get(d)!);
      const tail = closes.slice(-SPARKLINE_DAYS);
      return {
        ticker: h.ticker,
        name: h.name,
        sector: h.sector ?? "Unclassified",
        weight: h.weight,
        price: closes.at(-1)!,
        d1: periodReturn(byAsset[i]!, 1),
        d5: periodReturn(byAsset[i]!, 5),
        m1: periodReturn(byAsset[i]!, 21),
        riskShare: rc[i]!.share,
        sparkline: tail.map((c) => (c / tail[0]!) * 100),
      };
    })
    .sort((a, b) => b.weight - a.weight || a.ticker.localeCompare(b.ticker));

  const rv = rollingVolatility(returns, ROLLING_VOL_WINDOW);
  const { best, worst } = bestWorstDays(returnDates, returns);

  let correlation: Terminal["correlation"] = null;
  if (hs.length >= 2) {
    const m = correlationMatrix(byAsset);
    const pairs: { a: string; b: string; correlation: number }[] = [];
    let sum = 0;
    for (let i = 0; i < hs.length; i++) {
      for (let j = i + 1; j < hs.length; j++) {
        pairs.push({ a: hs[i]!.ticker, b: hs[j]!.ticker, correlation: m[i]![j]! });
        sum += m[i]![j]!;
      }
    }
    pairs.sort((x, y) => y.correlation - x.correlation);
    correlation = { average: sum / pairs.length, topPairs: pairs.slice(0, 3) };
  }

  const radar = await getMarketRadar(db, sessionId, portfolioId, { days: 7, now });
  const x = await getPortfolioExposures(db, sessionId, portfolioId);

  return {
    portfolio: loaded.portfolio,
    asOf: dates.at(-1)!,
    window: { from: dates[0]!, to: dates.at(-1)!, tradingDays: dates.length },
    index: { value: growth.at(-1)! * 100, dayChange: returns[last]! },
    equity,
    performance: perf,
    holdings: holdingsOut,
    risk: {
      volatility: annualizedVolatility(returns),
      sharpe: sharpeRatio(returns, 0),
      maxDrawdown: maxDrawdown(returns),
      var95: historicalVar(returns, 0.95),
      var99: historicalVar(returns, 0.99),
      expectedShortfall95: expectedShortfall(returns, 0.95),
      best,
      worst,
      upDayShare: upDayShare(returns),
    },
    extremes: topDays(returnDates, returns, 5),
    rollingVolatility: rv.map((value, i) => ({
      date: returnDates[i + ROLLING_VOL_WINDOW - 1]!,
      value,
    })),
    histogram: histogram(returns, 21),
    monthly: monthlyReturns(returnDates, returns),
    drawdowns: drawdownEpisodes(dates, returns, 3),
    correlation,
    news: radar.items.slice(0, 5).map((i) => ({
      title: i.title,
      url: i.url,
      score: i.relevance.score,
      tickers: i.relevance.matched.map((m) => m.ticker),
      class: i.classification?.class ?? null,
    })),
    exposures: x.available
      ? {
          available: true,
          effectiveFactors: x.concentration.effectiveFactors,
          effectiveSectors: x.concentration.effectiveSectors,
          topFactors: x.factors
            .slice(0, 3)
            .map((f) => ({ name: f.name, net: f.net, share: f.share })),
        }
      : { available: false, reason: x.reason },
  };
}
