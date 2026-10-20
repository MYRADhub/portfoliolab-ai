import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { llmRuns, type Db } from "@portfolio-lab/db";
import {
  EXPLAIN_PROMPT_VERSION,
  explainPortfolio,
  factsFromEntries,
  type Explanation,
  type ExplainGenerator,
  type Fact,
} from "@portfolio-lab/explain";
import { pct, signedPct } from "@/lib/format";
import { AppError } from "./errors";
import { getPortfolioCorrelation } from "./correlation";
import { getPortfolioExposures } from "./exposures";
import { getPortfolioAnalytics } from "./portfolios";
import { RateLimiter } from "./rate-limit";

export const DISCLAIMER =
  "PortfolioLab provides research information, not investment advice. Figures are computed from historical data and do not predict future results.";

const PURPOSE = "portfolio_explanation";

export const explainLimiter = new RateLimiter(10, 60 * 60 * 1000);

/** Every number the explanation may use, computed deterministically from the portfolio. */
export async function buildPortfolioFacts(
  db: Db,
  sessionId: string,
  portfolioId: string,
  now?: Date,
): Promise<Fact[]> {
  const a = await getPortfolioAnalytics(db, sessionId, portfolioId, { now });
  const byWeight = [...a.holdings].sort((x, y) => y.weight - x.weight);

  const entries: { label: string; text: string }[] = [
    {
      label: "Analysis window",
      text: `${a.window.from} to ${a.window.to} (${a.window.tradingDays} trading days)`,
    },
    {
      label: "Method",
      text: `Constant target weights rebalanced daily; risk-free rate ${pct(a.stats.riskFreeAnnual, 0)}`,
    },
    { label: "Number of holdings", text: `${a.holdings.length} holdings` },
    { label: "Largest holding", text: `${byWeight[0]!.ticker} ${pct(byWeight[0]!.weight)}` },
    { label: "Effective number of positions", text: a.concentration.effectiveN.toFixed(1) },
    { label: "Total return", text: signedPct(a.stats.totalReturn) },
    { label: "Annualized return", text: signedPct(a.stats.annualizedReturn) },
    { label: "Annualized volatility", text: pct(a.stats.annualizedVolatility) },
    { label: "Maximum drawdown", text: pct(a.stats.maxDrawdown) },
    { label: "Sharpe ratio", text: a.stats.sharpe.toFixed(2) },
  ];
  for (const s of a.sectors.slice(0, 3))
    entries.push({ label: "Sector weight", text: `${s.sector} ${pct(s.weight)}` });
  if (a.window.limitedBy)
    entries.push({ label: "Window limited by", text: `${a.window.limitedBy} price history` });

  if (a.holdings.length >= 2) {
    try {
      const c = await getPortfolioCorrelation(db, sessionId, portfolioId, { window: "1y", now });
      entries.push({
        label: "Average pairwise correlation (1 year)",
        text: c.averagePairwise.toFixed(2),
      });
      entries.push({ label: "Diversification ratio", text: c.diversificationRatio.toFixed(2) });
      const top = c.pairs[0]!;
      entries.push({
        label: "Most correlated pair",
        text: `${top.a} and ${top.b} ${top.correlation.toFixed(2)}`,
      });
      if (c.stress)
        entries.push({
          label: "Average correlation on the worst 10% of portfolio days",
          text: c.stress.averagePairwise.toFixed(2),
        });
    } catch (e) {
      // Correlation is optional context; thin history simply leaves these facts out.
      if (!(e instanceof AppError)) throw e;
    }
  }

  const x = await getPortfolioExposures(db, sessionId, portfolioId);
  if (x.available) {
    entries.push({
      label: "Effective number of sectors",
      text: x.concentration.effectiveSectors.toFixed(1),
    });
    if (x.concentration.effectiveFactors !== null) {
      entries.push({
        label: "Effective number of economic factors",
        text: x.concentration.effectiveFactors.toFixed(1),
      });
    }
    const top = x.factors[0];
    if (top && x.concentration.topFactorShare !== null) {
      entries.push({
        label: "Largest economic factor",
        text: `${top.name} ${pct(x.concentration.topFactorShare, 0)} of factor exposure`,
      });
    }
  }
  return factsFromEntries(entries);
}

export interface ExplainResult {
  explanation: Explanation;
  facts: Fact[];
  cached: boolean;
  disclaimer: string;
}

/**
 * Explains a session-owned portfolio. Grounded model output is cached by (facts, model, prompt version), so
 * repeats are free and do not count against the rate limit; fallback output is never cached.
 */
export async function getExplanation(
  db: Db,
  sessionId: string,
  portfolioId: string,
  generator: ExplainGenerator,
  opts: { now?: Date; limiter?: RateLimiter } = {},
): Promise<ExplainResult> {
  const { now, limiter = explainLimiter } = opts;
  const facts = await buildPortfolioFacts(db, sessionId, portfolioId, now);
  const hash = createHash("sha256")
    .update(JSON.stringify([EXPLAIN_PROMPT_VERSION, generator.model, facts]))
    .digest("hex");
  const key = and(
    eq(llmRuns.purpose, PURPOSE),
    eq(llmRuns.model, generator.model),
    eq(llmRuns.promptVersion, EXPLAIN_PROMPT_VERSION),
    eq(llmRuns.inputHash, hash),
  );

  const [hit] = await db.select().from(llmRuns).where(key);
  if (hit?.status === "ok") {
    return {
      explanation: hit.outputJson as Explanation,
      facts,
      cached: true,
      disclaimer: DISCLAIMER,
    };
  }

  if (!limiter.tryAcquire(sessionId)) {
    throw new AppError("rate_limited", "Too many explanation requests. Try again later.");
  }
  const explanation = await explainPortfolio(generator, facts);
  if (explanation.source === "model") {
    await db
      .insert(llmRuns)
      .values({
        purpose: PURPOSE,
        model: generator.model,
        promptVersion: EXPLAIN_PROMPT_VERSION,
        inputHash: hash,
        status: "ok",
        outputJson: explanation,
      })
      .onConflictDoNothing();
  }
  return { explanation, facts, cached: false, disclaimer: DISCLAIMER };
}
