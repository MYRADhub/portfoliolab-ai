import { and, eq } from "drizzle-orm";
import { portfolios, type Db } from "@portfolio-lab/db";
import type {
  AssistantAnswer,
  AssistantModel,
  AssistantTool,
  ToolEntry,
} from "@portfolio-lab/explain";
import { runAssistant } from "@portfolio-lab/explain";
import { pct, signedPct } from "@/lib/format";
import { AppError } from "./errors";
import { buildPortfolioFacts, DISCLAIMER, EXPLAIN_LIMIT } from "./explain";
import { getPortfolioExposures } from "./exposures";
import { getMarketRadar } from "./radar";
import { RateLimiter } from "./rate-limit";
import { getCompanyResearch, whatIfAdd } from "./research";
import { runStress, STRESS_PRESETS } from "./stress";

export const QUESTION_MAX = 500;
export const HISTORY_TURNS = 4;
export const HISTORY_ANSWER_MAX = 1500;

export interface Turn {
  question: string;
  answer: string;
}

/** Earlier turns as context only. Numbers in them are not facts: the model must call tools again for any figure. */
export function withHistory(question: string, history: readonly Turn[]): string {
  if (history.length === 0) return question;
  const thread = history
    .slice(-HISTORY_TURNS)
    .map((t) => `Q: ${t.question}\nA: ${t.answer}`)
    .join("\n");
  return `Earlier in this conversation (context only; call tools again for any number you need):\n${thread}\n\nNew question: ${question}`;
}

const NONE = { type: "object", properties: {}, additionalProperties: false };
const tickerParam = { type: "string", description: "Stock ticker, for example NVDA" };

/** Tools the assistant may call, scoped to one session-owned portfolio. Each returns only computed values. */
export function buildAssistantTools(
  db: Db,
  sessionId: string,
  portfolioId: string,
  now?: Date,
): AssistantTool[] {
  const asTicker = (a: unknown): string => {
    const t = (a as { ticker?: unknown })?.ticker;
    if (typeof t !== "string" || !/^[A-Za-z.\-]{1,10}$/.test(t))
      throw new Error("ticker must be a stock ticker");
    return t;
  };
  return [
    {
      name: "get_portfolio_summary",
      description:
        "Return and risk figures for the user's portfolio: window, returns, volatility, drawdown, concentration, correlation.",
      parameters: NONE,
      run: async () =>
        (await buildPortfolioFacts(db, sessionId, portfolioId, now)).map(({ label, text }) => ({
          label,
          text,
        })),
    },
    {
      name: "get_exposures",
      description:
        "The portfolio's hidden economic exposures: effective number of factors versus sectors and the largest factors.",
      parameters: NONE,
      run: async (): Promise<ToolEntry[]> => {
        const x = await getPortfolioExposures(db, sessionId, portfolioId);
        if (!x.available)
          return [
            {
              label: "Exposure data",
              text:
                x.reason === "no_factors"
                  ? "not loaded"
                  : `missing for ${x.missingTickers.join(", ")}`,
            },
          ];
        return [
          {
            label: "Effective number of sectors",
            text: x.concentration.effectiveSectors.toFixed(1),
          },
          ...(x.concentration.effectiveFactors === null
            ? []
            : [
                {
                  label: "Effective number of economic factors",
                  text: x.concentration.effectiveFactors.toFixed(1),
                },
              ]),
          ...x.factors.slice(0, 3).map((f) => ({
            label: "Factor share of exposure",
            text: `${f.name} ${pct(f.share, 0)}`,
          })),
        ];
      },
    },
    {
      name: "get_company",
      description: "Price statistics and the main hidden exposures of one company.",
      parameters: {
        type: "object",
        properties: { ticker: tickerParam },
        required: ["ticker"],
        additionalProperties: false,
      },
      run: async (args) => {
        const r = await getCompanyResearch(db, asTicker(args), { now });
        const t = r.company.ticker;
        const out: ToolEntry[] = [
          { label: `${t} sector`, text: r.company.sector ?? "unclassified" },
        ];
        const add = (label: string, v: number | null, f: (x: number) => string) => {
          if (v !== null) out.push({ label: `${t} ${label}`, text: f(v) });
        };
        add("return over 1 month", r.stats.m1, signedPct);
        add("return over 3 months", r.stats.m3, signedPct);
        add("return over 1 year", r.stats.y1, signedPct);
        add("annualized volatility", r.stats.volatility, (x) => pct(x));
        add("maximum drawdown", r.stats.maxDrawdown, (x) => pct(x));
        const fr = r.fundamentals.ratios;
        if (fr?.netMargin != null) out.push({ label: `${t} net margin`, text: pct(fr.netMargin) });
        if (fr?.revenueGrowth != null)
          out.push({ label: `${t} revenue growth`, text: signedPct(fr.revenueGrowth) });
        if (fr?.priceToEarnings != null)
          out.push({ label: `${t} price to earnings`, text: fr.priceToEarnings.toFixed(1) });
        for (const e of r.exposures.slice(0, 3))
          out.push({
            label: `${t} exposure`,
            text: `${e.name} ${e.signed > 0 ? "+" : ""}${e.signed} of 3`,
          });
        return out;
      },
    },
    {
      name: "get_news",
      description:
        "The most relevant recent news for the user's portfolio, optionally for one ticker, with class and relevance score.",
      parameters: {
        type: "object",
        properties: { ticker: tickerParam },
        additionalProperties: false,
      },
      run: async (args) => {
        const ticker = (args as { ticker?: string } | undefined)?.ticker;
        const radar = await getMarketRadar(db, sessionId, portfolioId, {
          days: 7,
          now,
          ticker: ticker ? asTicker(args).toUpperCase() : undefined,
        });
        return radar.items.slice(0, 5).map((i) => ({
          label: "News",
          text: `${i.title} (${i.classification?.class ?? "unclassified"}, relevance ${i.relevance.score.toFixed(1)} of 10)`,
        }));
      },
    },
    {
      name: "what_if_add",
      description:
        "Effect on hidden concentration of adding a company to the portfolio at a given weight in percent.",
      parameters: {
        type: "object",
        properties: {
          ticker: tickerParam,
          weight_pct: { type: "number", description: "Position size in percent, 1 to 50" },
        },
        required: ["ticker"],
        additionalProperties: false,
      },
      run: async (args) => {
        const w = (args as { weight_pct?: number })?.weight_pct ?? 5;
        const r = await whatIfAdd(db, sessionId, portfolioId, asTicker(args), w / 100);
        if (!r.available) return [{ label: "What-if", text: `not available (${r.reason})` }];
        const s = r.score;
        const out: ToolEntry[] = [
          { label: `${r.ticker} added at`, text: pct(r.weight, 0) },
          {
            label: "Effective factors before",
            text: s.before.effectiveFactors?.toFixed(2) ?? "n/a",
          },
          { label: "Effective factors after", text: s.after.effectiveFactors?.toFixed(2) ?? "n/a" },
          { label: "Effective sectors after", text: s.after.effectiveSectors.toFixed(2) },
        ];
        if (s.offsets.length)
          out.push({
            label: "Leans against",
            text: s.offsets.map((x) => r.factorNames[x] ?? x).join(", "),
          });
        return out;
      },
    },
    {
      name: "run_stress",
      description: `Illustrative scenario impact on the portfolio. Scenarios: ${STRESS_PRESETS.map((p) => p.id).join(", ")}.`,
      parameters: {
        type: "object",
        properties: { preset: { type: "string", enum: STRESS_PRESETS.map((p) => p.id) } },
        required: ["preset"],
        additionalProperties: false,
      },
      run: async (args) => {
        const preset = (args as { preset?: string })?.preset;
        const r = await runStress(db, sessionId, portfolioId, { preset });
        if (!r.available)
          return [{ label: "Stress test", text: "not available without exposure data" }];
        if (!r.touched)
          return [{ label: "Stress test", text: "no holding is exposed to this scenario" }];
        return [
          { label: `Estimated impact, ${preset}`, text: signedPct(r.portfolioImpact, 2) },
          { label: "Vulnerability score", text: `${r.vulnerability.toFixed(1)} of 10` },
          {
            label: "Hardest hit holding",
            text: `${r.holdings[0]!.ticker} ${signedPct(r.holdings[0]!.impact, 1)}`,
          },
        ];
      },
    },
  ];
}

export interface AssistantResult {
  result: AssistantAnswer;
  disclaimer: string;
}

/** Answers a question about a session-owned portfolio, grounded in what the tools return. Counts against the shared AI limit. */
export async function askAssistant(
  db: Db,
  sessionId: string,
  portfolioId: string,
  question: string,
  model: AssistantModel,
  opts: { now?: Date; limiter?: RateLimiter; history?: readonly Turn[] } = {},
): Promise<AssistantResult> {
  const q = question.trim();
  if (q.length < 3 || q.length > QUESTION_MAX)
    throw new AppError("bad_request", `Question must be 3 to ${QUESTION_MAX} characters`);
  const [owned] = await db
    .select({ id: portfolios.id })
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.sessionId, sessionId)));
  if (!owned) throw new AppError("not_found", "Portfolio not found");

  const limiter = opts.limiter ?? new RateLimiter(db, EXPLAIN_LIMIT.max, EXPLAIN_LIMIT.windowMs);
  if (!(await limiter.tryAcquire(`explain:${sessionId}`)))
    throw new AppError("rate_limited", "Too many explanation requests. Try again later.");

  const result = await runAssistant(
    model,
    withHistory(q, opts.history ?? []),
    buildAssistantTools(db, sessionId, portfolioId, opts.now),
  );
  return { result, disclaimer: DISCLAIMER };
}
