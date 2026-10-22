import { asc } from "drizzle-orm";
import { factors, type Db } from "@portfolio-lab/db";
import {
  PERCENT_PER_POINT,
  stress,
  vulnerabilityScore,
  type StressHolding,
  type StressResult,
} from "@portfolio-lab/finance";
import { AppError } from "./errors";
import { getPortfolioExposures } from "./exposures";

export interface StressPreset {
  id: string;
  name: string;
  description: string;
  /** Factor slug to shock size, from -1 (severe fall) to +1 (severe rise). */
  shocks: Record<string, number>;
}

/** Illustrative scenarios built from the factor taxonomy. They are what-ifs, not predictions. */
export const STRESS_PRESETS: StressPreset[] = [
  {
    id: "rate-shock",
    name: "Interest rates jump",
    description: "Borrowing costs rise sharply and inflation proves stickier than hoped.",
    shocks: { interest_rates: 1, inflation: 0.5 },
  },
  {
    id: "oil-spike",
    name: "Oil price spike",
    description: "A supply disruption sends oil sharply higher.",
    shocks: { oil_price: 1, inflation: 0.5 },
  },
  {
    id: "ai-pullback",
    name: "AI spending pullback",
    description: "Big customers cut AI infrastructure budgets and chip demand cools.",
    shocks: {
      ai_infrastructure_capex: -1,
      semiconductor_demand: -0.7,
      enterprise_it_spending: -0.4,
    },
  },
  {
    id: "taiwan-disruption",
    name: "Taiwan supply disruption",
    description: "Shipping and chip production out of Taiwan are interrupted.",
    shocks: { taiwan_supply_chain_risk: 1, semiconductor_demand: -0.4 },
  },
  {
    id: "recession",
    name: "Recession",
    description: "Growth stalls and households and businesses spend less.",
    shocks: {
      economic_growth: -1,
      consumer_spending: -0.8,
      enterprise_it_spending: -0.4,
      china_demand: -0.4,
    },
  },
  {
    id: "strong-dollar",
    name: "Strong dollar",
    description: "The dollar surges, squeezing overseas earnings.",
    shocks: { usd_strength: 1, china_demand: -0.3 },
  },
];

export interface StressCatalog {
  available: boolean;
  /** Factors the portfolio has any exposure to, with a short name for the sliders. */
  factors: { slug: string; name: string; category: string }[];
  presets: StressPreset[];
  percentPerPoint: number;
}

export type StressOutcome =
  | { available: false; reason: "no_factors" | "missing_exposures"; missingTickers: string[] }
  | {
      available: true;
      shocks: Record<string, number>;
      /** Shocked factors the portfolio has no exposure to (ignored). */
      ignored: string[];
      portfolioImpact: number;
      vulnerability: number;
      reliability: number | null;
      touched: boolean;
      holdings: StressResult["holdings"];
      factors: { slug: string; name: string; contribution: number }[];
      percentPerPoint: number;
    };

export async function getStressCatalog(
  db: Db,
  sessionId: string,
  portfolioId: string,
): Promise<StressCatalog> {
  const exp = await getPortfolioExposures(db, sessionId, portfolioId);
  const all = await db.select().from(factors).orderBy(asc(factors.name));
  if (!exp.available)
    return { available: false, factors: [], presets: [], percentPerPoint: PERCENT_PER_POINT };
  const held = new Set(exp.factors.map((f) => f.slug));
  const slugs = new Set(all.map((f) => f.slug));
  return {
    available: true,
    factors: all
      .filter((f) => held.has(f.slug))
      .map((f) => ({ slug: f.slug, name: f.name, category: f.category })),
    presets: STRESS_PRESETS.filter((p) =>
      Object.keys(p.shocks).some((s) => slugs.has(s) && held.has(s)),
    ),
    percentPerPoint: PERCENT_PER_POINT,
  };
}

export async function runStress(
  db: Db,
  sessionId: string,
  portfolioId: string,
  input: { preset?: string; shocks?: Record<string, number> },
): Promise<StressOutcome> {
  let shocks: Record<string, number>;
  if (input.preset) {
    const p = STRESS_PRESETS.find((x) => x.id === input.preset);
    if (!p) throw new AppError("bad_request", "Unknown scenario");
    shocks = p.shocks;
  } else shocks = input.shocks ?? {};
  const exp = await getPortfolioExposures(db, sessionId, portfolioId);
  if (!exp.available)
    return { available: false, reason: exp.reason, missingTickers: exp.missingTickers };

  const byTicker = new Map<string, StressHolding>(
    exp.holdings.map((h) => [h.ticker, { ticker: h.ticker, weight: h.weight, exposures: {} }]),
  );
  for (const c of exp.cells) {
    const h = byTicker.get(c.ticker);
    if (h)
      (h.exposures as Record<string, { signed: number; confidence: number }>)[c.factor] = {
        signed: c.signed,
        confidence: c.confidence,
      };
  }
  const held = new Set(exp.factors.map((f) => f.slug));
  const active = Object.fromEntries(Object.entries(shocks).filter(([s]) => held.has(s)));
  const result = stress([...byTicker.values()], active);
  const names = new Map(exp.factors.map((f) => [f.slug, f.name]));
  return {
    available: true,
    shocks,
    ignored: Object.keys(shocks).filter((s) => !held.has(s)),
    portfolioImpact: result.portfolioImpact,
    vulnerability: vulnerabilityScore(result.portfolioImpact),
    reliability: result.reliability,
    touched: result.touched,
    holdings: result.holdings,
    factors: result.factors.map((f) => ({ ...f, name: names.get(f.slug) ?? f.slug })),
    percentPerPoint: PERCENT_PER_POINT,
  };
}
