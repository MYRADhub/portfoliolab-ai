import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  benchmarkPrices,
  companies,
  factors,
  holdings,
  portfolios,
  type Db,
} from "@portfolio-lab/db";
import { proxySensitivity, spearman } from "@portfolio-lab/finance";
import { FORCE_PROXIES } from "@portfolio-lab/shared";
import { AppError } from "./errors";
import { loadMarket } from "./events";
import { exposureMap } from "./research";

/** The check uses the two years that end where the one-year window of the forces page begins, so the two never overlap. */
export const CHECK_YEARS = 2;
export const CHECK_GAP_DAYS = 370;
export const MIN_CHECK_DAYS = 120;
const CACHE_MS = 10 * 60 * 1000;
let cached: { at: number; result: PriceCheckUniverse } | null = null;

export interface ForceCheck {
  slug: string;
  name: string;
  /** The market signal the force is checked against, or null when it has none. */
  proxy: string | null;
  /** Companies with enough prices to measure. */
  companies: number;
  /** Companies the scores say are exposed (score not 0). */
  scored: number;
  /** Rank correlation, across all measured companies, between score and measured sensitivity (as a t-statistic). */
  spearman: number | null;
  /** Scored companies whose measured sensitivity is reliable (|t| of at least 2). */
  reliable: number;
  /** Share of those whose measured direction matches the score's direction. */
  signAgreement: number | null;
}

export interface PriceCheckUniverse {
  window: { from: string; to: string; days: number };
  forces: ForceCheck[];
  /** Measured sensitivity of each company to each force's signal, by ticker then force slug. */
  measured: Map<string, Record<string, { beta: number; t: number }>>;
}

function returnsBySymbol(rows: { symbol: string; date: string; adjClose: number }[]) {
  const out = new Map<string, Map<string, number>>();
  let prev: (typeof rows)[number] | null = null;
  for (const r of rows) {
    if (prev && prev.symbol === r.symbol && prev.adjClose > 0) {
      const m = out.get(r.symbol) ?? new Map<string, number>();
      m.set(r.date, r.adjClose / prev.adjClose - 1);
      out.set(r.symbol, m);
    }
    prev = r;
  }
  return out;
}

/**
 * Checks the exposure scores against prices. For each force with a market signal, every company's sensitivity to
 * that signal beyond the market is measured over an earlier window, then compared with its score.
 */
export async function getPriceCheck(
  db: Db,
  opts: { now?: Date } = {},
): Promise<PriceCheckUniverse> {
  if (!opts.now && cached && Date.now() - cached.at < CACHE_MS) return cached.result;
  const now = opts.now ?? new Date();
  const end = new Date(now.getTime() - CHECK_GAP_DAYS * 86_400_000);
  const start = new Date(end.getTime() - CHECK_YEARS * 365 * 86_400_000);
  const to = end.toISOString().slice(0, 10);
  const from = start.toISOString().slice(0, 10);

  const symbols = [
    "SPY",
    ...Object.values(FORCE_PROXIES).flatMap((p) =>
      p ? [p.symbol, ...(p.minus ? [p.minus] : [])] : [],
    ),
  ];
  const fund = returnsBySymbol(
    await db
      .select({
        symbol: benchmarkPrices.symbol,
        date: benchmarkPrices.date,
        adjClose: benchmarkPrices.adjClose,
      })
      .from(benchmarkPrices)
      .where(
        and(
          inArray(benchmarkPrices.symbol, [...new Set(symbols)]),
          gte(benchmarkPrices.date, from),
          lte(benchmarkPrices.date, to),
        ),
      )
      .orderBy(asc(benchmarkPrices.symbol), asc(benchmarkPrices.date)),
  );
  const spy = fund.get("SPY") ?? new Map<string, number>();
  const dates = [...spy.keys()].sort();
  const market = await loadMarket(db, from, to);
  const profiles = await exposureMap(db);
  const universe = (await db.select().from(companies)).filter((c) => profiles.has(c.id));
  const names = new Map((await db.select().from(factors)).map((f) => [f.slug, f.name]));

  const measured = new Map<string, Record<string, { beta: number; t: number }>>();
  const forces: ForceCheck[] = [];
  for (const [slug, proxy] of Object.entries(FORCE_PROXIES)) {
    if (!names.has(slug)) continue;
    const scoredCount = universe.filter((c) => (profiles.get(c.id)![slug] ?? 0) !== 0).length;
    const base: ForceCheck = {
      slug,
      name: names.get(slug)!,
      proxy: proxy?.label ?? null,
      companies: 0,
      scored: scoredCount,
      spearman: null,
      reliable: 0,
      signAgreement: null,
    };
    if (!proxy) {
      forces.push(base);
      continue;
    }
    const a = fund.get(proxy.symbol);
    const b = proxy.minus ? fund.get(proxy.minus) : null;
    const signal = new Map<string, number>();
    for (const d of dates) {
      const x = a?.get(d);
      const y = proxy.minus ? b?.get(d) : 0;
      if (x !== undefined && y !== undefined) signal.set(d, proxy.sign * (x - y));
    }
    const scores: number[] = [];
    const ts: number[] = [];
    let reliable = 0;
    let agree = 0;
    for (const c of universe) {
      const own = market.returns.get(c.ticker);
      if (!own) continue;
      const s: number[] = [];
      const m: number[] = [];
      const g: number[] = [];
      for (const d of dates) {
        const r = own.get(d);
        const sig = signal.get(d);
        if (r === undefined || sig === undefined) continue;
        s.push(r);
        m.push(spy.get(d)!);
        g.push(sig);
      }
      if (s.length < MIN_CHECK_DAYS) continue;
      const fit = proxySensitivity(s, m, g);
      if (!fit || !Number.isFinite(fit.t)) continue;
      const rec = measured.get(c.ticker) ?? {};
      rec[slug] = { beta: fit.beta, t: fit.t };
      measured.set(c.ticker, rec);
      const score = profiles.get(c.id)![slug] ?? 0;
      scores.push(score);
      ts.push(fit.t);
      if (score !== 0 && Math.abs(fit.t) >= 2) {
        reliable++;
        if (Math.sign(fit.t) === Math.sign(score)) agree++;
      }
    }
    forces.push({
      ...base,
      companies: scores.length,
      spearman: spearman(scores, ts),
      reliable,
      signAgreement: reliable ? agree / reliable : null,
    });
  }
  forces.sort((x, y) => (y.spearman ?? -2) - (x.spearman ?? -2) || x.name.localeCompare(y.name));
  const result: PriceCheckUniverse = {
    window: { from: dates[0] ?? from, to: dates.at(-1) ?? to, days: dates.length },
    forces,
    measured,
  };
  if (!opts.now) cached = { at: Date.now(), result };
  return result;
}

export interface HoldingCheck {
  ticker: string;
  slug: string;
  score: number;
  /** Measured sensitivity as a t-statistic, or null when it could not be measured. */
  t: number | null;
  /** "agrees", "disagrees" (a reliable measurement in the opposite direction), or "unclear" (not reliable). */
  verdict: "agrees" | "disagrees" | "unclear";
}

export type PortfolioPriceCheck =
  | { available: false; reason: "no_prices" }
  | {
      available: true;
      window: PriceCheckUniverse["window"];
      forces: ForceCheck[];
      holdings: HoldingCheck[];
    };

/** The universe-wide check, plus each scored exposure of the portfolio's holdings set against its measurement. */
export async function getPortfolioPriceCheck(
  db: Db,
  sessionId: string,
  portfolioId: string,
  opts: { now?: Date } = {},
): Promise<PortfolioPriceCheck> {
  const [p] = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.sessionId, sessionId)));
  if (!p) throw new AppError("not_found", "Portfolio not found");
  const check = await getPriceCheck(db, opts);
  if (check.window.days < MIN_CHECK_DAYS) return { available: false, reason: "no_prices" };
  const held = await db
    .select({ id: companies.id, ticker: companies.ticker })
    .from(holdings)
    .innerJoin(companies, eq(companies.id, holdings.companyId))
    .where(eq(holdings.portfolioId, portfolioId));
  const profiles = await exposureMap(db);
  const rows: HoldingCheck[] = [];
  for (const h of held) {
    for (const [slug, score] of Object.entries(profiles.get(h.id) ?? {})) {
      if (score === 0 || !FORCE_PROXIES[slug]) continue;
      const t = check.measured.get(h.ticker)?.[slug]?.t ?? null;
      rows.push({
        ticker: h.ticker,
        slug,
        score,
        t,
        verdict:
          t === null || Math.abs(t) < 2
            ? "unclear"
            : Math.sign(t) === Math.sign(score)
              ? "agrees"
              : "disagrees",
      });
    }
  }
  rows.sort((a, b) => a.ticker.localeCompare(b.ticker) || Math.abs(b.score) - Math.abs(a.score));
  return { available: true, window: check.window, forces: check.forces, holdings: rows };
}
