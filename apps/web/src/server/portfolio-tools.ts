import type { Db } from "@portfolio-lab/db";
import type { AssistantTool, Display, ToolEntry, ToolOutput } from "@portfolio-lab/explain";
import { pct, signedPct } from "@/lib/format";
import { getBenchmark } from "./benchmark";
import { getPortfolioCorrelation } from "./correlation";
import { getDiscovery } from "./discovery";
import { getInsights } from "./insights";
import { getPortfolioMove } from "./move";
import { DEFAULT_FIT_WEIGHT, fitFor, loadFitContext, type PortfolioFit } from "./portfolio-fit";
import { getRebalance } from "./rebalance";
import { getSimulation } from "./simulation";
import { runStress } from "./stress";
import { getWatchlist } from "./watchlist";

const TICKER = /^[A-Za-z.\-]{1,10}$/;
const tickerParam = { type: "string", description: "Stock ticker, for example NVDA" };
const weightParam = {
  type: "number",
  description:
    "Position size in percent, 1 to 50. Default 5. The other holdings shrink in proportion.",
};
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const arg = <T>(a: unknown, k: string) =>
  (a as Record<string, unknown> | null)?.[k] as T | undefined;
const pp = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} percentage points`;
const pc = (x: number) => Math.round(x * 1000) / 10;
const two = (x: number | null) => (x === null ? "n/a" : x.toFixed(2));

function weightArg(a: unknown): number {
  const w = arg<number>(a, "weight_pct");
  if (w === undefined) return DEFAULT_FIT_WEIGHT;
  if (typeof w !== "number" || !(w > 0 && w <= 50))
    throw new Error("weight_pct must be above 0 and at most 50");
  return w / 100;
}

/** Facts for one fit. Every difference is computed here, since the model may not do arithmetic. */
export function fitEntries(f: PortfolioFit): ToolEntry[] {
  const t = f.candidate.ticker;
  const w = pct(f.weight, 0);
  const span = `${f.window.from} to ${f.window.to}`;
  const b = f.history.before;
  const a = f.history.after;
  const out: ToolEntry[] = [
    {
      label: `Fit of ${t} at ${w}`,
      text: `${f.heldWeight !== null ? `already held at ${pct(f.heldWeight)}; this adds ${w} more` : `added at ${w}`}, other holdings scaled down in proportion; backtest over ${span} (${f.window.tradingDays} trading days), constant weights rebalanced daily`,
    },
    {
      label: `Correlation of ${t} with the portfolio (daily returns)`,
      text: f.correlation.withPortfolio.toFixed(2),
    },
    {
      label: `Portfolio volatility with ${t} at ${w}`,
      text: `${pct(a.volatility)} versus ${pct(b.volatility)} without (${pp(a.volatility - b.volatility)})`,
    },
    {
      label: `Portfolio return with ${t} at ${w}, ${span}`,
      text: `${signedPct(a.totalReturn)} versus ${signedPct(b.totalReturn)} without (${pp(a.totalReturn - b.totalReturn)})`,
    },
    {
      label: `Portfolio maximum drawdown with ${t} at ${w}`,
      text: `${pct(a.maxDrawdown)} versus ${pct(b.maxDrawdown)} without (${pp(a.maxDrawdown - b.maxDrawdown)})`,
    },
    {
      label: `${t} on its own, ${span}`,
      text: `return ${signedPct(f.history.candidate.totalReturn)}, volatility ${pct(f.history.candidate.volatility)}, maximum drawdown ${pct(f.history.candidate.maxDrawdown)}`,
    },
  ];
  if (a.beta !== null && b.beta !== null)
    out.push({
      label: `Portfolio beta to SPY with ${t} at ${w}`,
      text: `${a.beta.toFixed(2)} versus ${b.beta.toFixed(2)} without; ${t} alone ${two(f.history.candidate.beta)}`,
    });
  const hi = f.correlation.byHolding[0];
  const lo = f.correlation.byHolding.at(-1);
  if (hi)
    out.push({
      label: `Holding most correlated with ${t}`,
      text: `${hi.ticker} ${hi.correlation.toFixed(2)}`,
    });
  if (lo && lo !== hi)
    out.push({
      label: `Holding least correlated with ${t}`,
      text: `${lo.ticker} ${lo.correlation.toFixed(2)}`,
    });
  for (const s of f.sectors.slice(0, 2))
    if (Math.abs(s.after - s.before) >= 0.0005)
      out.push({
        label: `${s.sector} sector weight with ${t} at ${w}`,
        text: `${pct(s.after)} versus ${pct(s.before)} without`,
      });
  const c = f.concentration;
  if (c) {
    if (c.before.effectiveFactors !== null && c.after.effectiveFactors !== null)
      out.push({
        label: `Effective number of hidden forces with ${t} at ${w}`,
        text: `${c.after.effectiveFactors.toFixed(2)} versus ${c.before.effectiveFactors.toFixed(2)} without (higher is more spread out)`,
      });
    out.push({
      label: `Effective number of sectors with ${t} at ${w}`,
      text: `${c.after.effectiveSectors.toFixed(2)} versus ${c.before.effectiveSectors.toFixed(2)} without`,
    });
    if (c.adds.length)
      out.push({
        label: `Forces ${t} adds most to`,
        text: c.adds.map((x) => c.factorNames[x] ?? x).join(", "),
      });
    if (c.offsets.length)
      out.push({
        label: `Forces where ${t} leans against the portfolio`,
        text: c.offsets.map((x) => c.factorNames[x] ?? x).join(", "),
      });
  } else if (f.heldWeight === null) {
    out.push({
      label: `Hidden exposures of ${t}`,
      text: "not scored, or portfolio exposure data missing",
    });
  }
  for (const o of f.overlaps.slice(0, 3))
    out.push({
      label: `Overlap of ${t} with ${o.ticker}`,
      text: `both lean the same way on ${o.factors.join(", ")}`,
    });
  for (const s of f.stress)
    if (Math.abs(s.after - s.before) >= 0.0005 || s.before !== 0)
      out.push({
        label: `Scenario "${s.name}" with ${t} at ${w}`,
        text: `estimated ${signedPct(s.after)} versus ${signedPct(s.before)} without`,
      });
  return out;
}

export function fitDisplays(f: PortfolioFit): Display[] {
  const t = f.candidate.ticker;
  const b = f.history.before;
  const a = f.history.after;
  const out: Display[] = [
    {
      kind: "table",
      title: `Portfolio with and without ${t} at ${pct(f.weight, 0)}`,
      columns: ["Measure", "Without", `With ${t}`, "Change"],
      rows: [
        [
          "Return, last year",
          signedPct(b.totalReturn),
          signedPct(a.totalReturn),
          pp(a.totalReturn - b.totalReturn),
        ],
        ["Volatility", pct(b.volatility), pct(a.volatility), pp(a.volatility - b.volatility)],
        [
          "Maximum drawdown",
          pct(b.maxDrawdown),
          pct(a.maxDrawdown),
          pp(a.maxDrawdown - b.maxDrawdown),
        ],
        ...(a.beta !== null && b.beta !== null
          ? [
              [
                "Beta to SPY",
                b.beta.toFixed(2),
                a.beta.toFixed(2),
                (a.beta - b.beta >= 0 ? "+" : "") + (a.beta - b.beta).toFixed(2),
              ],
            ]
          : []),
        ...(f.concentration?.before.effectiveFactors != null &&
        f.concentration.after.effectiveFactors != null
          ? [
              [
                "Effective hidden forces",
                f.concentration.before.effectiveFactors.toFixed(2),
                f.concentration.after.effectiveFactors.toFixed(2),
                (f.concentration.after.effectiveFactors - f.concentration.before.effectiveFactors >=
                0
                  ? "+"
                  : "") +
                  (
                    f.concentration.after.effectiveFactors - f.concentration.before.effectiveFactors
                  ).toFixed(2),
              ],
            ]
          : []),
      ],
    },
    {
      kind: "bar",
      title: `Correlation of ${t} with each holding`,
      unit: "number",
      categories: f.correlation.byHolding.map((h) => h.ticker),
      series: [
        {
          name: "Correlation",
          values: f.correlation.byHolding.map((h) => Math.round(h.correlation * 100) / 100),
        },
      ],
    },
  ];
  if (f.stress.length)
    out.push({
      kind: "bar",
      title: `Scenario impact with and without ${t} (%)`,
      unit: "percent",
      categories: f.stress.map((s) => s.name),
      series: [
        { name: "Without", values: f.stress.map((s) => pc(s.before)) },
        { name: `With ${t}`, values: f.stress.map((s) => pc(s.after)) },
      ],
    });
  if (f.exposureGrid && f.exposureGrid.columns.length)
    out.push({
      kind: "heatmap",
      title: `Hidden exposures: holdings and ${t} (-3 to 3)`,
      unit: "score",
      rows: f.exposureGrid.rows,
      columns: f.exposureGrid.columns,
      values: f.exposureGrid.values,
      diverging: true,
    });
  return out;
}

/** Tools about the selected portfolio, beyond the original assistant's: fit, ranking, and the app's analytics. */
export function buildPortfolioTools(
  db: Db,
  sessionId: string,
  portfolioId: string,
  now: Date,
): AssistantTool[] {
  let ctxPromise: ReturnType<typeof loadFitContext> | null = null;
  // One question often asks about several candidates; the portfolio side is loaded once.
  const ctx = () => (ctxPromise ??= loadFitContext(db, sessionId, portfolioId, now));
  return [
    {
      name: "portfolio_fit",
      description:
        "How one company would fit the user's portfolio if added at a size (default 5%): correlation with the portfolio and each holding, return, volatility, drawdown and beta with and without it over the last year, sector and hidden-exposure concentration before and after, overlapping holdings, and scenario impacts before and after. A backtest, not a forecast. Offers a table and charts.",
      parameters: obj({ ticker: tickerParam, weight_pct: weightParam }, ["ticker"]),
      run: async (a): Promise<ToolOutput> => {
        const t = arg<string>(a, "ticker");
        if (typeof t !== "string" || !TICKER.test(t))
          throw new Error("ticker must be a stock ticker");
        const f = await fitFor(await ctx(), t, weightArg(a));
        return { entries: fitEntries(f), displays: fitDisplays(f) };
      },
    },
    {
      name: "rank_fit",
      description:
        "Compare two to six candidate companies on how each would fit the user's portfolio at the same size: correlation, change in volatility, drawdown and hidden-force spread. Ranked by correlation with the portfolio, lowest first. Offers a table and a chart.",
      parameters: obj({ tickers: { type: "array", items: tickerParam }, weight_pct: weightParam }, [
        "tickers",
      ]),
      run: async (a): Promise<ToolOutput> => {
        const list = arg<unknown>(a, "tickers");
        if (!Array.isArray(list)) throw new Error("tickers must be a list");
        const tickers = [...new Set(list.map((x) => String(x).toUpperCase()))];
        if (tickers.length < 2 || tickers.length > 6 || tickers.some((x) => !TICKER.test(x)))
          throw new Error("give 2 to 6 stock tickers");
        const w = weightArg(a);
        const c = await ctx();
        const fits: PortfolioFit[] = [];
        const entries: ToolEntry[] = [];
        for (const t of tickers) {
          try {
            fits.push(await fitFor(c, t, w));
          } catch (e) {
            entries.push({
              label: `Fit of ${t}`,
              text: `not available: ${e instanceof Error ? e.message : "error"}`,
            });
          }
        }
        fits.sort((x, y) => x.correlation.withPortfolio - y.correlation.withPortfolio);
        const dF = (f: PortfolioFit) =>
          f.concentration?.after.effectiveFactors != null &&
          f.concentration.before.effectiveFactors != null
            ? f.concentration.after.effectiveFactors - f.concentration.before.effectiveFactors
            : null;
        fits.forEach((f, i) => {
          const d = dF(f);
          entries.push({
            label: `Rank ${i + 1} by correlation: ${f.candidate.ticker} at ${pct(w, 0)}`,
            text: `correlation ${f.correlation.withPortfolio.toFixed(2)}; volatility ${pp(f.history.after.volatility - f.history.before.volatility)}; maximum drawdown ${pp(f.history.after.maxDrawdown - f.history.before.maxDrawdown)}; return ${pp(f.history.after.totalReturn - f.history.before.totalReturn)}${d === null ? "" : `; hidden-force spread ${d >= 0 ? "+" : ""}${d.toFixed(2)}`}`,
          });
        });
        const displays: Display[] = fits.length
          ? [
              {
                kind: "table",
                title: `Candidates at ${pct(w, 0)}: change to the portfolio`,
                columns: [
                  "Ticker",
                  "Correlation",
                  "Volatility",
                  "Max drawdown",
                  "Return",
                  "Hidden forces",
                ],
                rows: fits.map((f) => {
                  const d = dF(f);
                  return [
                    f.candidate.ticker,
                    f.correlation.withPortfolio.toFixed(2),
                    pp(f.history.after.volatility - f.history.before.volatility).replace(
                      " percentage points",
                      " pp",
                    ),
                    pp(f.history.after.maxDrawdown - f.history.before.maxDrawdown).replace(
                      " percentage points",
                      " pp",
                    ),
                    pp(f.history.after.totalReturn - f.history.before.totalReturn).replace(
                      " percentage points",
                      " pp",
                    ),
                    d === null ? "-" : `${d >= 0 ? "+" : ""}${d.toFixed(2)}`,
                  ];
                }),
              },
              {
                kind: "scatter",
                title: "Candidates: correlation against change in volatility",
                x: { label: "Correlation with the portfolio", unit: "number" },
                y: { label: "Change in portfolio volatility (pp)", unit: "number" },
                points: fits.map((f) => ({
                  label: f.candidate.ticker,
                  x: Math.round(f.correlation.withPortfolio * 100) / 100,
                  y:
                    Math.round((f.history.after.volatility - f.history.before.volatility) * 1000) /
                    10,
                })),
              },
            ]
          : [];
        return { entries, displays };
      },
    },
    {
      name: "get_correlation",
      description:
        "How the user's holdings move together over the last year: average pairwise correlation, diversification ratio, the most and least correlated pairs, each holding's correlation with the portfolio, and correlation on the worst market days.",
      parameters: obj({}),
      run: async (): Promise<ToolOutput> => {
        const c = await getPortfolioCorrelation(db, sessionId, portfolioId, { window: "1y", now });
        const entries: ToolEntry[] = [
          { label: "Average pairwise correlation (1 year)", text: c.averagePairwise.toFixed(2) },
          { label: "Diversification ratio (1 year)", text: c.diversificationRatio.toFixed(2) },
          ...c.pairs.slice(0, 2).map((p) => ({
            label: "Most correlated pair",
            text: `${p.a} and ${p.b} ${p.correlation.toFixed(2)}`,
          })),
          ...c.pairs.slice(-1).map((p) => ({
            label: "Least correlated pair",
            text: `${p.a} and ${p.b} ${p.correlation.toFixed(2)}`,
          })),
        ];
        if (c.stress)
          entries.push({
            label: `Average pairwise correlation on the worst ${pct(c.stress.fraction, 0)} of days`,
            text: c.stress.averagePairwise.toFixed(2),
          });
        const order = c.order.map((i) => c.tickers[i]!);
        return {
          entries,
          displays: [
            {
              kind: "heatmap",
              title: "Correlation of daily returns, last year",
              unit: "number",
              rows: order,
              columns: order,
              values: c.order.map((i) =>
                c.order.map((j) => Math.round(c.matrix[i]![j]! * 100) / 100),
              ),
              diverging: true,
            },
            {
              kind: "bar",
              title: "Each holding's correlation with the portfolio",
              unit: "number",
              categories: c.withPortfolio.map((x) => x.ticker),
              series: [
                {
                  name: "Correlation",
                  values: c.withPortfolio.map((x) => Math.round(x.correlation * 100) / 100),
                },
              ],
            },
          ],
        };
      },
    },
    {
      name: "compare_to_market",
      description:
        "The user's portfolio against the S&P 500 (SPY) over up to three years: beta, alpha, correlation, tracking error, up and down capture, and calendar-year returns. Offers a chart.",
      parameters: obj({}),
      run: async (): Promise<ToolOutput> => {
        const r = await getBenchmark(db, sessionId, portfolioId, { now });
        if (!r.available)
          return { entries: [{ label: "Market comparison", text: `not available (${r.reason})` }] };
        const s = r.stats;
        const e: ToolEntry[] = [
          { label: "Market comparison window", text: `${r.window.from} to ${r.window.to}` },
        ];
        const add = (label: string, v: number | null, f: (x: number) => string) => {
          if (v !== null) e.push({ label, text: f(v) });
        };
        add("Beta to SPY", s.beta, (x) => x.toFixed(2));
        add("Alpha (annualized)", s.alpha, signedPct);
        add("Correlation with SPY", s.correlation, (x) => x.toFixed(2));
        add("Tracking error", s.trackingError, (x) => pct(x));
        add("Active return (annualized)", s.activeReturn, signedPct);
        add("Up capture", s.upCapture, (x) => x.toFixed(2));
        add("Down capture", s.downCapture, (x) => x.toFixed(2));
        for (const y of r.years)
          e.push({
            label: `Calendar ${y.year}${y.partial ? " (partial)" : ""}`,
            text: `portfolio ${signedPct(y.portfolio)}, SPY ${signedPct(y.benchmark)}`,
          });
        const step = Math.max(1, Math.ceil(r.curves.dates.length / 260));
        const idx = r.curves.dates
          .map((_, i) => i)
          .filter((i) => i % step === 0 || i === r.curves.dates.length - 1);
        return {
          entries: e,
          displays: [
            {
              kind: "line",
              title: "Portfolio and SPY (each starts at 100)",
              unit: "index",
              series: [
                {
                  name: "Portfolio",
                  points: idx.map((i) => ({
                    date: r.curves.dates[i]!,
                    value: Math.round(r.curves.portfolio[i]! * 100) / 100,
                  })),
                },
                {
                  name: "SPY",
                  points: idx.map((i) => ({
                    date: r.curves.dates[i]!,
                    value: Math.round(r.curves.benchmark[i]! * 100) / 100,
                  })),
                },
              ],
            },
          ],
        };
      },
    },
    {
      name: "simulate_outcomes",
      description:
        "Possible paths of the user's portfolio over 1 to 10 years, built by resampling its own recent daily returns: median, 5th and 95th percentile ending values, chance of a loss, and typical drawdowns. A projection of the past, not a forecast.",
      parameters: obj({ years: { type: "number", description: "1 to 10, default 3" } }),
      run: async (a): Promise<ToolOutput> => {
        const years = Math.max(1, Math.min(10, Math.round(Number(arg(a, "years") ?? 3)) || 3));
        const s = await getSimulation(db, sessionId, portfolioId, { years, now });
        const m = s.summary;
        return {
          entries: [
            {
              label: "Simulation method",
              text: `${s.paths} paths over ${s.horizonYears} years from the portfolio's daily returns ${s.history.from} to ${s.history.to}${s.assumedAnnualReturn === null ? "" : `, centred on an assumed ${signedPct(s.assumedAnnualReturn)} a year`}`,
            },
            {
              label: `Median ending value of 100 after ${years} years`,
              text: m.medianEnd.toFixed(1),
            },
            { label: `5th percentile ending value after ${years} years`, text: m.p5End.toFixed(1) },
            {
              label: `95th percentile ending value after ${years} years`,
              text: m.p95End.toFixed(1),
            },
            {
              label: `Share of paths ending with a loss after ${years} years`,
              text: pct(m.probLoss),
            },
            {
              label: `Share of paths ending 20% or more down after ${years} years`,
              text: pct(m.probLoss20),
            },
            { label: "Median worst drawdown along a path", text: pct(m.medianMaxDrawdown) },
          ],
          displays: [
            {
              kind: "line",
              title: `Simulated value of 100 over ${years} years (percentiles)`,
              unit: "index",
              series: (["p5", "p25", "p50", "p75", "p95"] as const).map((k) => ({
                name: k.replace("p", "") + "th",
                points: s.fan.map((p) => ({
                  date: `day ${p.day}`,
                  value: Math.round(p[k] * 10) / 10,
                })),
              })),
            },
          ],
        };
      },
    },
    {
      name: "alternative_weightings",
      description:
        "How the same holdings would have behaved over the last three years with other weightings (equal weights, lowest volatility, equal risk, smallest hidden exposure) compared with the current weights: volatility, return, drawdown and hidden-force spread. Describes the past only; it says nothing about what to do.",
      parameters: obj({}),
      run: async (): Promise<ToolOutput> => {
        const r = await getRebalance(db, sessionId, portfolioId, { now });
        const entries: ToolEntry[] = [
          {
            label: "Alternative weightings window",
            text: `${r.window.from} to ${r.window.to}; in-sample, so it describes the past`,
          },
          ...r.strategies.map((s) => ({
            label: `Weighting "${s.name}"`,
            text: `volatility ${pct(s.volatility)}, annual return ${signedPct(s.annualReturn)}, maximum drawdown ${pct(s.maxDrawdown)}${s.effectiveFactors === null ? "" : `, hidden forces ${s.effectiveFactors.toFixed(2)}`}`,
          })),
        ];
        return {
          entries,
          displays: [
            {
              kind: "scatter",
              title: "Weightings: volatility against annual return",
              x: { label: "Volatility (%)", unit: "percent" },
              y: { label: "Annual return (%)", unit: "percent" },
              points: r.strategies.map((s) => ({
                label: s.name,
                x: pc(s.volatility),
                y: pc(s.annualReturn),
              })),
            },
          ],
        };
      },
    },
    {
      name: "find_diversifiers",
      description:
        "Companies in our universe that would most spread out the portfolio's hidden economic forces if added at 5%, optionally within one sector. A diversification screen, not a recommendation.",
      parameters: obj({ sector: { type: "string" } }),
      run: async (a) => {
        const sector = arg<string>(a, "sector");
        const d = await getDiscovery(db, sessionId, portfolioId, {
          limit: 8,
          ...(sector ? { sector } : {}),
        });
        if (!d.available)
          return [{ label: "Diversifier screen", text: `not available (${d.reason})` }];
        return [
          {
            label: "Effective hidden forces now",
            text: d.before.effectiveFactors === null ? "n/a" : d.before.effectiveFactors.toFixed(2),
          },
          ...d.candidates.map((c) => ({
            label: `Diversifier ${c.ticker} (${c.sector ?? "unclassified"})`,
            text: `hidden forces after ${c.effectiveFactorsAfter === null ? "n/a" : c.effectiveFactorsAfter.toFixed(2)}${c.hedge ? ", leans against current exposures" : ""}${c.offsets.length ? `; offsets ${c.offsets.map((x) => d.factorNames[x] ?? x).join(", ")}` : ""}`,
          })),
        ];
      },
    },
    {
      name: "custom_scenario",
      description:
        'Estimate the portfolio\'s move under a scenario you define as shocks to economic forces (factor slugs from list_factors), each from -1 (severe fall) to +1 (severe rise). For example {"interest_rates": 1, "oil": -0.5}. A linear what-if, not a forecast.',
      parameters: obj(
        {
          shocks: {
            type: "object",
            additionalProperties: { type: "number" },
            description: "factor slug to shock, -1 to 1",
          },
        },
        ["shocks"],
      ),
      run: async (a): Promise<ToolOutput> => {
        const raw = arg<Record<string, unknown>>(a, "shocks") ?? {};
        const shocks = Object.fromEntries(
          Object.entries(raw)
            .filter(
              ([k, v]) =>
                /^[a-z0-9_]{2,40}$/.test(k) && typeof v === "number" && Number.isFinite(v),
            )
            .map(([k, v]) => [k, Math.max(-1, Math.min(1, v as number))]),
        );
        if (!Object.keys(shocks).length)
          throw new Error("give at least one factor shock between -1 and 1");
        const r = await runStress(db, sessionId, portfolioId, { shocks });
        if (!r.available)
          return {
            entries: [{ label: "Custom scenario", text: "not available without exposure data" }],
          };
        const desc = Object.entries(shocks)
          .map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}`)
          .join(", ");
        const entries: ToolEntry[] = [
          { label: "Custom scenario shocks", text: desc },
          {
            label: "Estimated portfolio impact, custom scenario",
            text: signedPct(r.portfolioImpact, 2),
          },
          {
            label: "Vulnerability score, custom scenario",
            text: `${r.vulnerability.toFixed(1)} of 10`,
          },
        ];
        if (r.ignored.length)
          entries.push({ label: "Shocks no holding is exposed to", text: r.ignored.join(", ") });
        for (const h of r.holdings.slice(0, 3))
          entries.push({
            label: `Custom scenario impact on ${h.ticker}`,
            text: signedPct(h.impact, 1),
          });
        return {
          entries,
          displays: r.touched
            ? [
                {
                  kind: "bar",
                  title: "Custom scenario: estimated move by holding (%)",
                  unit: "percent",
                  categories: r.holdings.map((h) => h.ticker),
                  series: [{ name: "Estimated move", values: r.holdings.map((h) => pc(h.impact)) }],
                },
              ]
            : [],
        };
      },
    },
    {
      name: "todays_move",
      description:
        "What moved the user's portfolio on the latest trading day: its return, the biggest contributors, and linked news.",
      parameters: obj({}),
      run: async () => {
        const m = await getPortfolioMove(db, sessionId, portfolioId, { now });
        return [
          { label: `Portfolio return on ${m.date}`, text: signedPct(m.portfolioReturn, 2) },
          ...[...m.holdings]
            .sort((x, y) => Math.abs(y.contribution) - Math.abs(x.contribution))
            .slice(0, 4)
            .map((h) => ({
              label: `${h.ticker} on ${m.date}`,
              text: `${signedPct(h.assetReturn, 2)}, contributing ${(h.contribution * 100 >= 0 ? "+" : "") + (h.contribution * 100).toFixed(2)} percentage points`,
            })),
          ...m.news.slice(0, 3).map((n) => ({
            label: "News that day",
            text: n.title,
            source: { url: n.url, title: n.title },
          })),
        ];
      },
    },
    {
      name: "portfolio_insights",
      description:
        "The app's current alerts and observations about the user's portfolio (concentration, drawdown, unusual moves).",
      parameters: obj({}),
      run: async () => {
        const { insights } = await getInsights(db, sessionId, portfolioId, { now });
        return insights.length
          ? insights.map((i) => ({ label: `Insight (${i.severity}): ${i.title}`, text: i.detail }))
          : [{ label: "Insights", text: "nothing notable right now" }];
      },
    },
  ];
}

/** The visitor's watchlist with its alerts. Available with or without a portfolio. */
export function watchlistTool(db: Db, sessionId: string, now: Date): AssistantTool {
  return {
    name: "get_watchlist",
    description:
      "The companies the user follows on their watchlist, with recent signals and alerts.",
    parameters: obj({}),
    run: async () => {
      const w = await getWatchlist(db, sessionId, { now });
      if (!w.items.length) return [{ label: "Watchlist", text: "empty" }];
      return [
        { label: "Watchlist", text: w.items.map((i) => i.ticker).join(", ") },
        ...w.alerts
          .slice(0, 8)
          .map((a) => ({ label: `Watchlist alert ${a.ticker}`, text: a.alert.text })),
      ];
    },
  };
}
