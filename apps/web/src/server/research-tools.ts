import { and, desc, eq, gte, ilike, isNull, lte } from "drizzle-orm";
import { MIN_LINK_SCORE } from "@portfolio-lab/data";
import {
  diffSections,
  filingSectionText,
  parseFullTextHits,
  recentFilings,
  RESEARCH_FORMS,
  type EdgarClient,
  type FilingRef,
  type FilingSection,
} from "@portfolio-lab/data";
import {
  companies,
  companyFactorExposures,
  factors,
  newsArticles,
  newsCompanyLinks,
  type Db,
} from "@portfolio-lab/db";
import {
  domainOf,
  pickPassages,
  type AssistantTool,
  type Display,
  type ToolEntry,
  type ToolOutput,
  type WebSearcher,
} from "@portfolio-lab/explain";
import { annualizedVolatility, maxDrawdown, pearson } from "@portfolio-lab/finance";
import { compactUsd, pct, signedPct } from "@/lib/format";
import { buildAssistantTools } from "./assistant";
import { buildPortfolioTools, watchlistTool } from "./portfolio-tools";
import {
  BENCHMARK_TICKER,
  closesFor,
  fundamentalsFor,
  marketSnapshot,
  thin,
  type CompanySnapshot,
} from "./market-snapshot";
import { getPortfolioAnalytics, searchCompanies } from "./portfolios";
import { monthsAgo } from "./portfolio-data";
import { getCompanyResearch } from "./research";

export type EdgarLike = Pick<EdgarClient, "submissions" | "document" | "fullTextSearch">;

export interface ResearchToolContext {
  db: Db;
  sessionId: string;
  /** A session-owned portfolio, already checked; null when the chat is not about one. */
  portfolioId: string | null;
  now?: Date;
  /** Null turns the web tools off (no OpenAI key). */
  web: WebSearcher | null;
  /** Null turns the SEC tools off (no SEC_USER_AGENT). */
  edgar: EdgarLike | null;
}

const TICKER = /^[A-Za-z.\-]{1,10}$/;
const tickerParam = { type: "string", description: "Stock ticker, for example NVDA" };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

function arg<T>(a: unknown, key: string): T | undefined {
  return (a as Record<string, unknown> | null)?.[key] as T | undefined;
}
function tickerArg(a: unknown, key = "ticker"): string {
  const t = arg<unknown>(a, key);
  if (typeof t !== "string" || !TICKER.test(t)) throw new Error(`${key} must be a stock ticker`);
  return t.toUpperCase();
}
function tickersArg(a: unknown, min: number, max: number): string[] {
  const list = arg<unknown>(a, "tickers");
  if (!Array.isArray(list)) throw new Error("tickers must be a list");
  const out = [...new Set(list.map((t) => (typeof t === "string" ? t.toUpperCase() : "")))];
  if (out.length < min || out.length > max || out.some((t) => !TICKER.test(t)))
    throw new Error(`give ${min} to ${max} stock tickers`);
  return out;
}

const price = (x: number) => `$${x.toFixed(2)}`;
/** A fraction as percent for charts, to one decimal like the facts. */
const pc = (x: number | null | undefined) => (x == null ? null : Math.round(x * 1000) / 10);
const ratio = (x: number) => x.toFixed(1);
const signedScore = (x: number) => `${x > 0 ? "+" : ""}${x}`;

async function companyRow(db: Db, ticker: string) {
  const [c] = await db.select().from(companies).where(eq(companies.ticker, ticker));
  if (!c) throw new Error(`unknown ticker ${ticker}; call find_companies to look it up`);
  return c;
}

/** Keeps the last `n` document fetches; filings are large and the same one is often read twice in a row. */
const docCache = new Map<string, Promise<string>>();
function cachedDocument(edgar: EdgarLike, url: string): Promise<string> {
  const hit = docCache.get(url);
  if (hit) return hit;
  const p = edgar.document(url);
  docCache.set(url, p);
  p.catch(() => docCache.delete(url));
  while (docCache.size > 12) docCache.delete(docCache.keys().next().value!);
  return p;
}

const SECTION_NAME: Record<FilingSection, string> = {
  business: "Business",
  risk_factors: "Risk Factors",
  mdna: "Management's Discussion and Analysis",
  all: "full document",
};

const PERIODS = ["1m", "3m", "6m", "ytd", "1y", "3y", "5y"] as const;
type Period = (typeof PERIODS)[number];
const PERIOD_LABEL: Record<Period, string> = {
  "1m": "1 month",
  "3m": "3 months",
  "6m": "6 months",
  ytd: "year to date",
  "1y": "1 year",
  "3y": "3 years",
  "5y": "5 years",
};
function periodStart(p: Period, now: Date): string {
  if (p === "ytd") return `${now.getUTCFullYear()}-01-01`;
  const months = { "1m": 1, "3m": 3, "6m": 6, "1y": 12, "3y": 36, "5y": 60 }[p];
  return monthsAgo(now, months);
}

const SORTS = {
  return_1y: (c: CompanySnapshot) => c.r1y,
  return_3m: (c: CompanySnapshot) => c.r3m,
  return_1m: (c: CompanySnapshot) => c.r1m,
  volatility: (c: CompanySnapshot) => c.volatility,
  pe: (c: CompanySnapshot) => c.ratios?.priceToEarnings ?? null,
  net_margin: (c: CompanySnapshot) => c.ratios?.netMargin ?? null,
  revenue_growth: (c: CompanySnapshot) => c.ratios?.revenueGrowth ?? null,
  market_cap: (c: CompanySnapshot) => c.marketCap,
} as const;
type SortKey = keyof typeof SORTS | "factor";

function snapshotLine(c: CompanySnapshot): string {
  const parts: string[] = [];
  if (c.r1y !== null) parts.push(`1y ${signedPct(c.r1y)}`);
  if (c.r3m !== null) parts.push(`3m ${signedPct(c.r3m)}`);
  if (c.volatility !== null) parts.push(`volatility ${pct(c.volatility)}`);
  if (c.ratios?.priceToEarnings != null) parts.push(`P/E ${ratio(c.ratios.priceToEarnings)}`);
  if (c.ratios?.netMargin != null) parts.push(`net margin ${pct(c.ratios.netMargin)}`);
  if (c.ratios?.revenueGrowth != null)
    parts.push(`revenue growth ${signedPct(c.ratios.revenueGrowth)}`);
  return parts.join(", ") || "no price or fundamental data";
}

function riskReturn(title: string, cs: readonly CompanySnapshot[]): Display {
  return {
    kind: "scatter",
    title,
    x: { label: "Annualized volatility (%)", unit: "percent" },
    y: { label: "1-year return (%)", unit: "percent" },
    points: cs.map((c) => ({ label: c.ticker, x: pc(c.volatility)!, y: pc(c.r1y)! })),
  };
}

/** Every tool the research chat may call, given what this server has configured. */
export function buildResearchTools(ctx: ResearchToolContext): AssistantTool[] {
  const { db, now = new Date() } = ctx;
  const tools: AssistantTool[] = [
    {
      name: "find_companies",
      description:
        "Look up companies in our S&P 500 universe by ticker or name. Use it when a ticker is unclear or a company is named.",
      parameters: obj(
        { query: { type: "string", description: "Ticker or part of a company name" } },
        ["query"],
      ),
      run: async (a) => {
        const q = String(arg(a, "query") ?? "").slice(0, 40);
        const rows = await searchCompanies(db, q, 8);
        if (!rows.length) return [{ label: "Company search", text: `no company matches "${q}"` }];
        return rows.map((r) => ({
          label: `Company ${r.ticker}`,
          text: `${r.name} (${r.sector ?? "unclassified"})`,
        }));
      },
    },
    {
      name: "get_company",
      description:
        "Profile of one company from our data: sector, latest price, returns, risk, latest annual ratios, its strongest economic exposures and its closest peers. Offers a price chart and an exposure chart.",
      parameters: obj({ ticker: tickerParam }, ["ticker"]),
      run: async (a): Promise<ToolOutput> => {
        const r = await getCompanyResearch(db, tickerArg(a), { now });
        const t = r.company.ticker;
        const out: ToolEntry[] = [
          { label: `${t} name`, text: r.company.name },
          {
            label: `${t} sector`,
            text: `${r.company.sector ?? "unclassified"}${r.company.industry ? `, ${r.company.industry}` : ""}`,
          },
        ];
        const add = (label: string, v: number | null | undefined, f: (x: number) => string) => {
          if (v != null) out.push({ label: `${t} ${label}`, text: f(v) });
        };
        if (r.stats.last !== null && r.stats.asOf)
          out.push({ label: `${t} last close`, text: `${price(r.stats.last)} on ${r.stats.asOf}` });
        add("return over 1 day", r.stats.d1, signedPct);
        add("return over 1 month", r.stats.m1, signedPct);
        add("return over 3 months", r.stats.m3, signedPct);
        add("return over 1 year", r.stats.y1, signedPct);
        add("annualized volatility (1 year)", r.stats.volatility, (x) => pct(x));
        add("maximum drawdown (1 year)", r.stats.maxDrawdown, (x) => pct(x));
        add("52-week high close", r.stats.high52, price);
        add("52-week low close", r.stats.low52, price);
        const fr = r.fundamentals.ratios;
        if (fr) {
          const fy = `fiscal ${fr.fiscalYear}`;
          add(`revenue growth, ${fy}`, fr.revenueGrowth, signedPct);
          add(`net margin, ${fy}`, fr.netMargin, (x) => pct(x));
          add(`operating margin, ${fy}`, fr.operatingMargin, (x) => pct(x));
          add(`return on equity, ${fy}`, fr.returnOnEquity, (x) => pct(x));
          add(`price to earnings, ${fy} earnings`, fr.priceToEarnings, ratio);
        }
        for (const e of r.exposures.slice(0, 4))
          out.push({
            label: `${t} exposure to ${e.name}`,
            text: `${signedScore(e.signed)} on a scale of -3 to 3${e.rationale ? `: ${e.rationale}` : ""}`,
          });
        if (r.peers.length)
          out.push({
            label: `${t} closest peers (${r.peers[0]!.basis === "exposure" ? "by exposure profile" : "same sector"})`,
            text: r.peers.map((p) => p.ticker).join(", "),
          });
        const displays: Display[] = [];
        if (r.prices.length > 1)
          displays.push({
            kind: "line",
            title: `${t} price, last year`,
            unit: "price",
            series: [
              { name: t, points: thin(r.prices.map((p) => ({ date: p.date, value: p.close }))) },
            ],
          });
        if (r.exposures.length)
          displays.push({
            kind: "bar",
            title: `${t} economic exposures (-3 to 3)`,
            unit: "score",
            categories: r.exposures.slice(0, 10).map((e) => e.name),
            series: [{ name: "Exposure", values: r.exposures.slice(0, 10).map((e) => e.signed) }],
          });
        return { entries: out, displays };
      },
    },
    {
      name: "get_fundamentals",
      description:
        "Annual figures from SEC 10-K filings for one company, up to five fiscal years: revenue, net income, operating income, diluted EPS, operating cash flow. Offers a table and a trend chart.",
      parameters: obj({ ticker: tickerParam }, ["ticker"]),
      run: async (a): Promise<ToolOutput> => {
        const c = await companyRow(db, tickerArg(a));
        const years = ((await fundamentalsFor(db, [c.id])).get(c.id) ?? []).slice(0, 5);
        if (!years.length)
          return {
            entries: [{ label: `${c.ticker} fundamentals`, text: "not loaded for this company" }],
          };
        const metrics = [
          ["revenue", (y: (typeof years)[number]) => y.revenue, compactUsd],
          ["net income", (y: (typeof years)[number]) => y.netIncome, compactUsd],
          ["operating income", (y: (typeof years)[number]) => y.operatingIncome, compactUsd],
          ["diluted EPS", (y: (typeof years)[number]) => y.epsDiluted, price],
          ["operating cash flow", (y: (typeof years)[number]) => y.operatingCashFlow, compactUsd],
        ] as const;
        const entries: ToolEntry[] = [];
        for (const y of years)
          for (const [name, get, f] of metrics) {
            const v = get(y);
            if (v !== null)
              entries.push({ label: `${c.ticker} ${name}, fiscal ${y.fiscalYear}`, text: f(v) });
          }
        const ordered = [...years].reverse();
        const display: Display = {
          kind: "table",
          title: `${c.ticker} annual figures`,
          columns: ["Metric", ...ordered.map((y) => `FY${y.fiscalYear}`)],
          rows: metrics.map(([name, get, f]) => [
            name,
            ...ordered.map((y) => {
              const v = get(y);
              return v === null ? "-" : f(v);
            }),
          ]),
        };
        const trend: Display = {
          kind: "bar",
          title: `${c.ticker} revenue, net income and operating cash flow`,
          unit: "usd",
          categories: ordered.map((y) => `FY${y.fiscalYear}`),
          series: [
            { name: "Revenue", values: ordered.map((y) => y.revenue) },
            { name: "Net income", values: ordered.map((y) => y.netIncome) },
            { name: "Operating cash flow", values: ordered.map((y) => y.operatingCashFlow) },
          ].filter((x) => x.values.some((v) => v !== null)),
        };
        return { entries, displays: [display, trend] };
      },
    },
    {
      name: "price_history",
      description: `Price performance of one to five tickers over a period, from our daily prices: return, volatility, drawdown, the gap and daily-return correlation between the first ticker and the others. ${BENCHMARK_TICKER} is the S&P 500. Offers a chart rebased to 100.`,
      parameters: obj(
        {
          tickers: { type: "array", items: tickerParam, description: "One to five tickers" },
          period: { type: "string", enum: [...PERIODS] },
        },
        ["tickers", "period"],
      ),
      run: async (a): Promise<ToolOutput> => {
        const tickers = tickersArg(a, 1, 5);
        const period = (PERIODS as readonly string[]).includes(String(arg(a, "period")))
          ? (arg<Period>(a, "period") as Period)
          : "1y";
        const label = PERIOD_LABEL[period];
        const since = periodStart(period, now);
        const series = await Promise.all(tickers.map((t) => closesFor(db, t, since)));
        const entries: ToolEntry[] = [];
        const found: { ticker: string; rows: { date: string; close: number }[] }[] = [];
        tickers.forEach((t, i) => {
          const rows = series[i];
          if (!rows || rows.length < 2) {
            entries.push({
              label: `${t} price history`,
              text: rows ? "too short" : "not in our data",
            });
            return;
          }
          found.push({ ticker: t, rows });
          const closes = rows.map((r) => r.close);
          const rets = closes.slice(1).map((c, j) => c / closes[j]! - 1);
          const first = rows[0]!;
          const last = rows.at(-1)!;
          entries.push({
            label: `${t} return, ${label}`,
            text: `${signedPct(last.close / first.close - 1)} (${first.date} to ${last.date})`,
          });
          entries.push({ label: `${t} close on ${last.date}`, text: price(last.close) });
          if (rets.length >= 20) {
            entries.push({
              label: `${t} annualized volatility, ${label}`,
              text: pct(annualizedVolatility(rets)),
            });
            entries.push({
              label: `${t} maximum drawdown, ${label}`,
              text: pct(maxDrawdown(rets)),
            });
          }
        });
        if (found.length === 0) return { entries };
        // Common dates for the comparison and the chart.
        let common = new Set(found[0]!.rows.map((r) => r.date));
        for (const f of found.slice(1)) {
          const have = new Set(f.rows.map((r) => r.date));
          common = new Set([...common].filter((d) => have.has(d)));
        }
        const dates = [...common].sort();
        const aligned = found.map((f) => {
          const m = new Map(f.rows.map((r) => [r.date, r.close]));
          return dates.map((d) => m.get(d)!);
        });
        if (found.length > 1 && dates.length >= 20) {
          const base = aligned[0]!;
          const baseRet = base.at(-1)! / base[0]! - 1;
          const baseDaily = base.slice(1).map((c, j) => c / base[j]! - 1);
          found.slice(1).forEach((f, k) => {
            const other = aligned[k + 1]!;
            const gap = baseRet - (other.at(-1)! / other[0]! - 1);
            entries.push({
              label: `Return gap, ${found[0]!.ticker} minus ${f.ticker}, ${dates[0]} to ${dates.at(-1)}`,
              text: `${gap >= 0 ? "+" : ""}${(gap * 100).toFixed(1)} percentage points`,
            });
            const od = other.slice(1).map((c, j) => c / other[j]! - 1);
            entries.push({
              label: `Correlation of daily returns, ${found[0]!.ticker} and ${f.ticker}, ${label}`,
              text: pearson(baseDaily, od).toFixed(2),
            });
          });
        }
        const display: Display = {
          kind: "line",
          title: `${found.map((f) => f.ticker).join(" vs ")}, ${label}`,
          unit: found.length > 1 ? "index" : "price",
          series: found.map((f, i) => ({
            name: f.ticker,
            points: thin(
              dates.map((d, j) => ({
                date: d,
                value:
                  found.length > 1
                    ? Math.round((aligned[i]![j]! / aligned[i]![0]!) * 10000) / 100
                    : aligned[i]![j]!,
              })),
            ),
          })),
        };
        return { entries, display };
      },
    },
    {
      name: "compare_companies",
      description:
        "Side-by-side comparison of two to six companies from our data: sector, returns, volatility, P/E, net margin, revenue growth. Offers a table, a returns chart, a risk-against-return chart and an exposure heatmap.",
      parameters: obj({ tickers: { type: "array", items: tickerParam } }, ["tickers"]),
      run: async (a): Promise<ToolOutput> => {
        const tickers = tickersArg(a, 2, 6);
        const snap = await marketSnapshot(db, now);
        const by = new Map(snap.map((c) => [c.ticker, c]));
        const rows = tickers.map((t) => by.get(t) ?? null);
        const entries: ToolEntry[] = [];
        tickers.forEach((t, i) => {
          const c = rows[i];
          entries.push(
            c
              ? { label: `${t} (${c.sector ?? "unclassified"}) snapshot`, text: snapshotLine(c) }
              : { label: `${t} snapshot`, text: "not in our data" },
          );
        });
        const fmt = (v: number | null | undefined, f: (x: number) => string) =>
          v == null ? "-" : f(v);
        const display: Display = {
          kind: "table",
          title: "Comparison",
          columns: [
            "Ticker",
            "Sector",
            "1m",
            "3m",
            "1y",
            "Volatility",
            "P/E",
            "Net margin",
            "Rev. growth",
          ],
          rows: tickers.map((t, i) => {
            const c = rows[i];
            if (!c) return [t, "not in our data", "-", "-", "-", "-", "-", "-", "-"];
            return [
              t,
              c.sector ?? "-",
              fmt(c.r1m, signedPct),
              fmt(c.r3m, signedPct),
              fmt(c.r1y, signedPct),
              fmt(c.volatility, (x) => pct(x)),
              fmt(c.ratios?.priceToEarnings, ratio),
              fmt(c.ratios?.netMargin, (x) => pct(x)),
              fmt(c.ratios?.revenueGrowth, signedPct),
            ];
          }),
        };
        const known = rows.filter((c): c is CompanySnapshot => c !== null);
        const displays: Display[] = [display];
        if (known.length) {
          displays.push({
            kind: "bar",
            title: "Returns by period (%)",
            unit: "percent",
            categories: known.map((c) => c.ticker),
            series: [
              { name: "1 month", values: known.map((c) => pc(c.r1m)) },
              { name: "3 months", values: known.map((c) => pc(c.r3m)) },
              { name: "1 year", values: known.map((c) => pc(c.r1y)) },
            ],
          });
          const pts = known.filter((c) => c.volatility != null && c.r1y != null);
          if (pts.length >= 2) displays.push(riskReturn("Risk against return, last year", pts));
          const factorsUsed = [
            ...new Set(
              known.flatMap((c) => Object.keys(c.exposures).filter((k) => c.exposures[k])),
            ),
          ].sort();
          if (factorsUsed.length)
            displays.push({
              kind: "heatmap",
              title: "Economic exposures (-3 to 3)",
              unit: "score",
              rows: known.map((c) => c.ticker),
              columns: factorsUsed,
              values: known.map((c) => factorsUsed.map((f) => c.exposures[f] ?? 0)),
              diverging: true,
            });
        }
        return { entries, displays };
      },
    },
    {
      name: "screen_companies",
      description:
        "Screen the S&P 500 universe in our data. Filter by sector, by an economic exposure (factor slug from list_factors), and by ranges of returns, P/E, margins and growth; sort and return the top matches. Offers a table, a risk-against-return chart and, with a factor, an exposure chart.",
      parameters: obj({
        sector: {
          type: "string",
          description: "Sector name or part of it, for example Technology",
        },
        factor: { type: "string", description: "Factor slug from list_factors" },
        factor_direction: {
          type: "string",
          enum: ["positive", "negative"],
          description: "Keep companies helped (positive) or hurt (negative) when the factor rises",
        },
        min_return_1y: { type: "number", description: "Minimum 1-year return in percent" },
        max_return_1y: { type: "number", description: "Maximum 1-year return in percent" },
        max_pe: { type: "number" },
        min_net_margin: { type: "number", description: "Minimum net margin in percent" },
        min_revenue_growth: { type: "number", description: "Minimum revenue growth in percent" },
        max_volatility: { type: "number", description: "Maximum annualized volatility in percent" },
        sort_by: { type: "string", enum: [...Object.keys(SORTS), "factor"] },
        order: { type: "string", enum: ["asc", "desc"] },
        limit: { type: "number", description: "1 to 15, default 10" },
      }),
      run: async (a): Promise<ToolOutput> => {
        const snap = await marketSnapshot(db, now);
        const num = (k: string) => {
          const v = arg<unknown>(a, k);
          return typeof v === "number" && Number.isFinite(v) ? v : null;
        };
        const sector = String(arg(a, "sector") ?? "")
          .trim()
          .toLowerCase();
        const factor = String(arg(a, "factor") ?? "").trim();
        const dir = arg<string>(a, "factor_direction");
        const filters: string[] = [];
        let rows = snap;
        if (sector) {
          rows = rows.filter((c) => c.sector?.toLowerCase().includes(sector));
          filters.push(`sector contains "${sector}"`);
        }
        if (factor) {
          if (!snap.some((c) => factor in c.exposures))
            throw new Error(`unknown factor ${factor}; call list_factors`);
          rows = rows.filter((c) => {
            const v = c.exposures[factor] ?? 0;
            return dir === "negative" ? v < 0 : dir === "positive" ? v > 0 : v !== 0;
          });
          filters.push(`exposure to ${factor}${dir ? ` (${dir})` : ""}`);
        }
        const range = (
          key: string,
          get: (c: CompanySnapshot) => number | null | undefined,
          cmp: "min" | "max",
          scale = 100,
        ) => {
          const v = num(key);
          if (v === null) return;
          rows = rows.filter((c) => {
            const x = get(c);
            return x != null && (cmp === "min" ? x * scale >= v : x * scale <= v);
          });
          filters.push(`${key.replace(/_/g, " ")} ${v}`);
        };
        range("min_return_1y", (c) => c.r1y, "min");
        range("max_return_1y", (c) => c.r1y, "max");
        range("max_pe", (c) => c.ratios?.priceToEarnings, "max", 1);
        range("min_net_margin", (c) => c.ratios?.netMargin, "min");
        range("min_revenue_growth", (c) => c.ratios?.revenueGrowth, "min");
        range("max_volatility", (c) => c.volatility, "max");

        const sortBy = (arg<SortKey>(a, "sort_by") ?? (factor ? "factor" : "return_1y")) as SortKey;
        const key =
          sortBy === "factor"
            ? (c: CompanySnapshot) => (factor ? Math.abs(c.exposures[factor] ?? 0) : null)
            : (SORTS[sortBy as keyof typeof SORTS] ?? SORTS.return_1y);
        const desc_ = arg(a, "order") !== "asc";
        const limit = Math.max(1, Math.min(15, Math.floor(num("limit") ?? 10)));
        const sorted = rows
          .filter((c) => key(c) != null)
          .sort(
            (x, y) =>
              (desc_ ? key(y)! - key(x)! : key(x)! - key(y)!) || x.ticker.localeCompare(y.ticker),
          )
          .slice(0, limit);

        const entries: ToolEntry[] = [
          {
            label: "Screen",
            text: `${rows.length} of ${snap.length} companies match${filters.length ? ` (${filters.join("; ")})` : ""}; showing ${sorted.length} sorted by ${sortBy.replace(/_/g, " ")}`,
          },
          ...sorted.map((c) => ({
            label: `${c.ticker} ${c.name} (${c.sector ?? "unclassified"})`,
            text: `${snapshotLine(c)}${factor && c.exposures[factor] ? `, ${factor} exposure ${signedScore(c.exposures[factor]!)} of 3` : ""}`,
          })),
        ];
        const fmt = (v: number | null | undefined, f: (x: number) => string) =>
          v == null ? "-" : f(v);
        const display: Display = {
          kind: "table",
          title: "Screen results",
          columns: [
            "Ticker",
            "Name",
            "1y",
            "3m",
            "Volatility",
            "P/E",
            "Net margin",
            ...(factor ? [factor] : []),
          ],
          rows: sorted.map((c) => [
            c.ticker,
            c.name,
            fmt(c.r1y, signedPct),
            fmt(c.r3m, signedPct),
            fmt(c.volatility, (x) => pct(x)),
            fmt(c.ratios?.priceToEarnings, ratio),
            fmt(c.ratios?.netMargin, (x) => pct(x)),
            ...(factor ? [signedScore(c.exposures[factor] ?? 0)] : []),
          ]),
        };
        const displays: Display[] = [display];
        const pts = sorted.filter((c) => c.volatility != null && c.r1y != null);
        if (pts.length >= 3) displays.push(riskReturn("Screen results: risk against return", pts));
        if (factor)
          displays.push({
            kind: "bar",
            title: `Exposure to ${factor} (-3 to 3)`,
            unit: "score",
            categories: sorted.map((c) => c.ticker),
            series: [{ name: factor, values: sorted.map((c) => c.exposures[factor] ?? 0) }],
          });
        return { entries, displays };
      },
    },
    {
      name: "list_factors",
      description:
        "The economic exposures (factors) our data scores companies on, such as AI capital spending or interest rates, with how many companies are exposed to each. Use the slug with screen_companies.",
      parameters: obj({}),
      run: async () => {
        const fs = await db.select().from(factors).orderBy(factors.category, factors.slug);
        const exp = await db
          .select({
            factorId: companyFactorExposures.factorId,
            magnitude: companyFactorExposures.magnitude,
          })
          .from(companyFactorExposures)
          .where(isNull(companyFactorExposures.validTo));
        const counts = new Map<number, number>();
        for (const e of exp)
          if (e.magnitude > 0) counts.set(e.factorId, (counts.get(e.factorId) ?? 0) + 1);
        if (!fs.length) return [{ label: "Factors", text: "not loaded" }];
        return fs.map((f) => ({
          label: `Factor ${f.slug}`,
          text: `${f.name} (${f.category}), ${counts.get(f.id) ?? 0} companies exposed. ${f.description}`,
        }));
      },
    },
    {
      name: "search_news",
      description:
        "Headlines from our news database for the last days: by company (ticker), by words in the title, or both. Each comes with its link and, when classified, whether it is fundamental news.",
      parameters: obj({
        ticker: tickerParam,
        query: { type: "string", description: "Words that must appear in the headline" },
        days: { type: "number", description: "1 to 90, default 30" },
      }),
      run: async (a) => {
        const days = Math.max(1, Math.min(90, Math.floor(Number(arg(a, "days") ?? 30)) || 30));
        const from = new Date(now.getTime() - days * 86_400_000);
        const t = arg(a, "ticker") ? tickerArg(a) : null;
        const words = String(arg(a, "query") ?? "")
          .split(/\s+/)
          .filter((w) => w.length > 1)
          .slice(0, 5);
        if (!t && !words.length) throw new Error("give a ticker, a query, or both");
        const conds = [gte(newsArticles.publishedAt, from), lte(newsArticles.publishedAt, now)];
        for (const w of words)
          conds.push(ilike(newsArticles.title, `%${w.replace(/[\\%_]/g, "\\$&")}%`));
        let rows;
        if (t) {
          const c = await companyRow(db, t);
          rows = await db
            .selectDistinct({
              title: newsArticles.title,
              url: newsArticles.url,
              source: newsArticles.sourceName,
              publishedAt: newsArticles.publishedAt,
            })
            .from(newsCompanyLinks)
            .innerJoin(newsArticles, eq(newsArticles.id, newsCompanyLinks.articleId))
            .where(
              and(
                eq(newsCompanyLinks.companyId, c.id),
                gte(newsCompanyLinks.score, MIN_LINK_SCORE),
                ...conds,
              ),
            )
            .orderBy(desc(newsArticles.publishedAt))
            .limit(40);
        } else {
          rows = await db
            .select({
              title: newsArticles.title,
              url: newsArticles.url,
              source: newsArticles.sourceName,
              publishedAt: newsArticles.publishedAt,
            })
            .from(newsArticles)
            .where(and(...conds))
            .orderBy(desc(newsArticles.publishedAt))
            .limit(40);
        }
        const seen = new Set<string>();
        const out: ToolEntry[] = [];
        for (const r of rows) {
          const key = r.title.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const day = r.publishedAt.toISOString().slice(0, 10);
          out.push({
            label: `Headline, ${day}${r.source ? `, ${r.source}` : ""}`,
            text: r.title,
            source: { url: r.url, title: r.title, published: day },
          });
          if (out.length >= 10) break;
        }
        return out.length
          ? out
          : [{ label: "News", text: `no headlines in the last ${days} days` }];
      },
    },
  ];

  if (ctx.portfolioId) {
    const pid = ctx.portfolioId;
    tools.push({
      name: "get_holdings",
      description: "The holdings of the user's selected portfolio with their weights and sectors.",
      parameters: obj({}),
      run: async () => {
        const p = await getPortfolioAnalytics(db, ctx.sessionId, pid, { now });
        return [
          { label: "Portfolio name", text: p.portfolio.name },
          ...[...p.holdings]
            .sort((x, y) => y.weight - x.weight)
            .map((h) => ({
              label: `Holding ${h.ticker}`,
              text: `${h.name}, ${pct(h.weight)}, ${h.sector ?? "unclassified"}`,
            })),
        ];
      },
    });
    for (const t of buildAssistantTools(db, ctx.sessionId, pid, now)) {
      // The research chat has a richer company profile, and portfolio_fit covers what_if_add.
      if (t.name === "get_company" || t.name === "what_if_add") continue;
      tools.push(
        t.name === "get_news"
          ? {
              ...t,
              name: "get_portfolio_news",
              description:
                "The most relevant news of the last week for the user's portfolio, optionally for one ticker.",
            }
          : t,
      );
    }
    tools.push(...buildPortfolioTools(db, ctx.sessionId, pid, now));
  }
  tools.push(watchlistTool(db, ctx.sessionId, now));

  if (ctx.web) {
    const web = ctx.web;
    const toEntries = (rs: Awaited<ReturnType<WebSearcher["search"]>>): ToolEntry[] =>
      rs.map((r) => ({
        label: `${r.title} (${domainOf(r.url)}${r.published ? `, ${r.published}` : ""})`,
        text: r.snippet,
        kind: "web",
        source: { url: r.url, title: r.title, ...(r.published ? { published: r.published } : {}) },
      }));
    tools.push(
      {
        name: "web_search",
        description:
          "Search the web. Returns excerpts of pages with their text. Use for recent events, guidance, earnings releases, analyst commentary, and anything newer than our data.",
        parameters: obj({ query: { type: "string" } }, ["query"]),
        run: async (a, signal) => {
          const q = String(arg(a, "query") ?? "")
            .trim()
            .slice(0, 300);
          if (q.length < 2) throw new Error("query is empty");
          const r = toEntries(await web.search(q, signal));
          return r.length ? r : [{ label: "Web search", text: `no readable results for "${q}"` }];
        },
      },
      {
        name: "read_web_page",
        description:
          "Open one web page (for example a link found by web_search) and return excerpts, focused on what you look for.",
        parameters: obj(
          {
            url: { type: "string" },
            focus: { type: "string", description: "What to look for on the page" },
          },
          ["url"],
        ),
        run: async (a, signal) => {
          const url = String(arg(a, "url") ?? "");
          if (!/^https?:\/\/[^\s]+$/.test(url) || url.length > 500)
            throw new Error("url must be an http(s) link");
          const focus = arg<string>(a, "focus")?.slice(0, 200);
          const r = toEntries(await web.open(url, focus, signal));
          return r.length ? r : [{ label: "Web page", text: "could not be read" }];
        },
      },
    );
  }

  if (ctx.edgar) {
    const edgar = ctx.edgar;
    const cikOf = async (ticker: string) => {
      const c = await companyRow(db, ticker);
      if (!c.cik) throw new Error(`no SEC identifier stored for ${ticker}`);
      return { c, cik: c.cik };
    };
    tools.push(
      {
        name: "list_filings",
        description:
          "Recent SEC filings of one company: annual (10-K), quarterly (10-Q), current reports (8-K, for example earnings releases), proxies. Returns dates and links.",
        parameters: obj(
          {
            ticker: tickerParam,
            forms: { type: "array", items: { type: "string", enum: [...RESEARCH_FORMS] } },
            limit: { type: "number", description: "1 to 12, default 8" },
          },
          ["ticker"],
        ),
        run: async (a) => {
          const { c, cik } = await cikOf(tickerArg(a));
          const asked = arg<unknown>(a, "forms");
          const forms =
            Array.isArray(asked) && asked.length ? asked.map(String) : ["10-K", "10-Q", "8-K"];
          const limit = Math.max(1, Math.min(12, Math.floor(Number(arg(a, "limit") ?? 8)) || 8));
          const list = recentFilings(await edgar.submissions(cik), cik, forms, limit);
          if (!list.length)
            return [{ label: `${c.ticker} filings`, text: "none of those forms found" }];
          return list.map((f) => ({
            label: `${c.ticker} ${f.form} filed ${f.filingDate}`,
            text: `${f.reportDate ? `period ending ${f.reportDate}` : "no period stated"}${f.description ? `; ${f.description}` : ""}`,
            kind: "filing" as const,
            source: { url: f.url, title: `${c.ticker} ${f.form}`, published: f.filingDate },
          }));
        },
      },
      {
        name: "read_filing",
        description:
          "Read part of an SEC filing and return the passages most about your focus. Give a ticker and form to read the latest one (Business, Risk Factors or MD&A sections for 10-K and 10-Q; an 8-K includes its press-release exhibit), or a sec.gov Archives URL from list_filings or search_filings.",
        parameters: obj({
          ticker: tickerParam,
          form: { type: "string", enum: ["10-K", "10-Q", "8-K", "20-F", "DEF 14A"] },
          url: {
            type: "string",
            description: "A https://www.sec.gov/Archives/edgar/data/... document",
          },
          section: { type: "string", enum: ["business", "risk_factors", "mdna", "all"] },
          focus: {
            type: "string",
            description: "What to look for, for example 'China export restrictions'",
          },
        }),
        run: async (a, signal) => {
          const form = String(arg(a, "form") ?? "10-K");
          const section = (arg<FilingSection>(a, "section") ??
            (form === "8-K" ? "all" : "mdna")) as FilingSection;
          const focus = arg<string>(a, "focus")?.slice(0, 200);
          let urls: string[];
          let title: string;
          const given = arg<string>(a, "url");
          if (given) {
            if (!/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\/\d+\/[\w.\-]+$/.test(given))
              throw new Error("url must be a sec.gov Archives document");
            urls = [given];
            title = `${form} document`;
          } else {
            const { c, cik } = await cikOf(tickerArg(a));
            const [f]: FilingRef[] = recentFilings(await edgar.submissions(cik), cik, [form], 1);
            if (!f) return [{ label: `${c.ticker} ${form}`, text: "no such filing found" }];
            title = `${c.ticker} ${form} filed ${f.filingDate}`;
            urls = [f.url];
            if (form === "8-K") {
              // Earnings and other announcements live in exhibit 99; the 8-K itself is a short cover.
              const dir = f.url.slice(0, f.url.lastIndexOf("/") + 1);
              try {
                const index = JSON.parse(await edgar.document(`${dir}index.json`)) as {
                  directory?: { item?: { name: string }[] };
                };
                const ex = (index.directory?.item ?? [])
                  .map((i) => i.name)
                  .filter((n) => /ex-?99[\w.\-]*\.html?$/i.test(n))
                  .slice(0, 2);
                urls.push(...ex.map((n) => dir + n));
              } catch {
                // Without the index, the cover document alone is read.
              }
            }
          }
          signal?.throwIfAborted();
          const texts = await Promise.all(urls.map((u) => cachedDocument(edgar, u)));
          const out: ToolEntry[] = [];
          let anyFound = false;
          texts.forEach((html, i) => {
            const { text, found } = filingSectionText(html, form, i === 0 ? section : "all");
            anyFound ||= found;
            const per = urls.length > 1 ? 4 : 6;
            for (const p of pickPassages(text, focus, per))
              out.push({
                label: `${title}, ${i === 0 ? SECTION_NAME[section] : "exhibit"}, passage ${p.index}`,
                text: p.text,
                kind: "filing",
                source: { url: urls[i]!, title },
              });
          });
          if (!anyFound && section !== "all")
            out.unshift({
              label: `${title} note`,
              text: `the ${SECTION_NAME[section]} heading was not found; passages come from the whole document`,
            });
          return out.length
            ? out
            : [{ label: title, text: `nothing about "${focus ?? ""}" found in it` }];
        },
      },
      {
        name: "compare_filings",
        description:
          "What changed in a section of a company's filing between its latest 10-K (or 10-Q) and an earlier one: paragraphs added, removed, and reworded (with the new sentences). Found by comparing the texts, not by judgement. Use for 'what new risks did they disclose' questions. Offers a summary table.",
        parameters: obj(
          {
            ticker: tickerParam,
            form: { type: "string", enum: ["10-K", "10-Q"] },
            section: { type: "string", enum: ["risk_factors", "mdna", "business"] },
            against: {
              type: "string",
              enum: ["previous", "year_ago"],
              description:
                "Compare with the filing just before (default) or the one about a year earlier",
            },
            focus: { type: "string", description: "Show changes about this first" },
          },
          ["ticker"],
        ),
        run: async (a, signal): Promise<ToolOutput> => {
          const form = arg<string>(a, "form") === "10-Q" ? "10-Q" : "10-K";
          const section = (arg<FilingSection>(a, "section") ?? "risk_factors") as FilingSection;
          if (section === "all" || (form === "10-Q" && section === "business"))
            throw new Error("a 10-Q has risk_factors and mdna sections to compare");
          const { c, cik } = await cikOf(tickerArg(a));
          const list = recentFilings(await edgar.submissions(cik), cik, [form], 6);
          if (list.length < 2)
            return {
              entries: [
                { label: `${c.ticker} ${form} comparison`, text: "fewer than two filings found" },
              ],
            };
          const latest = list[0]!;
          const target = new Date(new Date(latest.filingDate).getTime() - 365 * 86_400_000)
            .toISOString()
            .slice(0, 10);
          const earlier =
            arg(a, "against") === "year_ago"
              ? list
                  .slice(1)
                  .reduce((best, f) =>
                    Math.abs(Date.parse(f.filingDate) - Date.parse(target)) <
                    Math.abs(Date.parse(best.filingDate) - Date.parse(target))
                      ? f
                      : best,
                  )
              : list[1]!;
          signal?.throwIfAborted();
          const [hNew, hOld] = await Promise.all([
            cachedDocument(edgar, latest.url),
            cachedDocument(edgar, earlier.url),
          ]);
          const nNew = filingSectionText(hNew, form, section);
          const nOld = filingSectionText(hOld, form, section);
          const name = SECTION_NAME[section];
          if (!nNew.found || !nOld.found)
            return {
              entries: [
                {
                  label: `${c.ticker} ${form} ${name} comparison`,
                  text: "the section heading was not found in one of the filings, so they cannot be compared section to section",
                },
              ],
            };
          const d = diffSections(nOld.text, nNew.text);
          const span = `${form} filed ${latest.filingDate} versus ${earlier.filingDate}`;
          const src = (f: FilingRef) => ({
            url: f.url,
            title: `${c.ticker} ${f.form} filed ${f.filingDate}`,
            published: f.filingDate,
          });
          const focus = arg<string>(a, "focus")?.slice(0, 200);
          // With a focus, changes about it come first; otherwise document order.
          const rank = (t: string) => (focus ? pickPassages(t, focus, 1).length : 0);
          const pick = (kind: string, n: number) =>
            d.changes
              .filter(
                (x) =>
                  x.kind === kind && (kind !== "reworded" || (x.newSentences?.length ?? 0) > 0),
              )
              .map((x, i) => ({
                x,
                i,
                r: rank(x.kind === "reworded" ? x.newSentences!.join(" ") : x.text),
              }))
              .sort((p, q) => q.r - p.r || p.i - q.i)
              .slice(0, n)
              .map((p) => p.x);
          const clip = (t: string) => {
            const w = t.split(/\s+/);
            return w.length > 90 ? `${w.slice(0, 90).join(" ")} ...` : t;
          };
          const entries: ToolEntry[] = [
            {
              label: `${c.ticker} ${name}, ${span}`,
              text: `${d.counts.added} paragraphs added, ${d.counts.removed} removed, ${d.counts.reworded} reworded, ${d.counts.unchanged} unchanged; ${d.words.after} words versus ${d.words.before}`,
              kind: "filing",
              source: src(latest),
            },
          ];
          pick("added", 6).forEach((x, i) =>
            entries.push({
              label: `${c.ticker} ${name}: added in the ${latest.filingDate} filing (${i + 1})`,
              text: clip(x.text),
              kind: "filing",
              source: src(latest),
            }),
          );
          pick("removed", 4).forEach((x, i) =>
            entries.push({
              label: `${c.ticker} ${name}: removed since the ${earlier.filingDate} filing (${i + 1})`,
              text: clip(x.text),
              kind: "filing",
              source: src(earlier),
            }),
          );
          pick("reworded", 4).forEach((x, i) =>
            entries.push({
              label: `${c.ticker} ${name}: new wording in the ${latest.filingDate} filing (${i + 1})`,
              text: clip(x.newSentences!.join(" ")),
              kind: "filing",
              source: src(latest),
            }),
          );
          return {
            entries,
            displays: [
              {
                kind: "table",
                title: `${c.ticker} ${name}: ${span}`,
                columns: ["Change", "Paragraphs"],
                rows: [
                  ["Added", String(d.counts.added)],
                  ["Removed", String(d.counts.removed)],
                  ["Reworded", String(d.counts.reworded)],
                  ["Unchanged", String(d.counts.unchanged)],
                  ["Words", `${d.words.before} to ${d.words.after}`],
                ],
              },
            ],
          };
        },
      },
      {
        name: "search_filings",
        description:
          "Full-text search across all SEC filings since 2001 (any company, including ones outside our universe). Use quotes for exact phrases. Returns matching filings with links; read one with read_filing.",
        parameters: obj(
          {
            query: { type: "string" },
            forms: { type: "array", items: { type: "string", enum: [...RESEARCH_FORMS] } },
            from: { type: "string", description: "Earliest filing date, YYYY-MM-DD" },
            ticker: { ...tickerParam, description: "Limit to one company" },
          },
          ["query"],
        ),
        run: async (a) => {
          const q = String(arg(a, "query") ?? "")
            .trim()
            .slice(0, 200);
          if (q.length < 2) throw new Error("query is empty");
          const from = arg<string>(a, "from");
          const forms = arg<unknown>(a, "forms");
          const ciks = arg(a, "ticker") ? [(await cikOf(tickerArg(a))).cik] : undefined;
          const r = parseFullTextHits(
            await edgar.fullTextSearch(q, {
              forms: Array.isArray(forms) ? forms.map(String) : undefined,
              from: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : undefined,
              ciks,
            }),
            8,
          );
          if (!r.hits.length) return [{ label: "Filing search", text: `no filings match ${q}` }];
          return [
            { label: "Filing search", text: `${r.total} documents match; newest relevant shown` },
            ...r.hits.map((h) => ({
              label: `${h.company}${h.ticker ? ` (${h.ticker})` : ""} ${h.form} filed ${h.filingDate}`,
              text: h.periodEnding ? `period ending ${h.periodEnding}` : "no period stated",
              kind: "filing" as const,
              source: { url: h.url, title: `${h.company} ${h.form}`, published: h.filingDate },
            })),
          ];
        },
      },
    );
  }

  return tools;
}
