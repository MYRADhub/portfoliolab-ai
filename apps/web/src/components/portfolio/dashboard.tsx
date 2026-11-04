"use client";

import { ArrowDownRight, ArrowUpRight, ChevronRight, Info } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { NewsCard } from "@/components/news/news-card";
import { GettingStarted } from "@/components/onboarding/getting-started";
import { Loading } from "@/components/ui/skeleton";
import { axisTick, chartColors, tooltipStyle } from "@/lib/chart";
import {
  calmness,
  contributions,
  summarize,
  trailingReturn,
  yearToDate,
} from "@/lib/dashboard-summary";
import { pct } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import type { BenchmarkResult } from "@/server/benchmark";
import type { Insight } from "@/server/insights";
import type { Radar } from "@/server/radar";
import type { Terminal } from "@/server/terminal";
import { ExplainPanel } from "./explain-panel";
import { MovePanel } from "./move-panel";
import { WithPortfolio } from "./with-portfolio";

const signed = (x: number, d = 1) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;
const tone = (x: number | null) =>
  x === null ? "text-muted-foreground" : x > 0 ? "text-gain" : x < 0 ? "text-loss" : "";

function Panel({
  title,
  action,
  children,
  className,
  label,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <section
      aria-label={label ?? title}
      className={cn("rounded-2xl border bg-card p-5 text-card-foreground", className)}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Figure({
  label,
  value,
  valueClass,
  note,
  explain,
}: {
  label: string;
  value: string;
  valueClass?: string;
  note?: React.ReactNode;
  explain: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-4 text-card-foreground">
      <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {label}
        <span title={explain} aria-label={`What is ${label}? ${explain}`} role="img">
          <Info className="size-3" aria-hidden="true" />
        </span>
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tracking-tight tabular-nums", valueClass)}>
        {value}
      </div>
      {note && <div className="mt-1 text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = values
    .map((v, i) => `${(i / (values.length - 1)) * 80},${22 - ((v - min) / span) * 20}`)
    .join(" ");
  const up = values.at(-1)! >= values[0]!;
  return (
    <svg viewBox="0 0 80 24" className={cn("h-6 w-20", className)} aria-hidden="true">
      <polyline
        points={d}
        fill="none"
        stroke={up ? "var(--gain)" : "var(--loss)"}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const RANGES = [
  { id: "1m", label: "1M", days: 21 },
  { id: "3m", label: "3M", days: 63 },
  { id: "ytd", label: "YTD", days: null },
  { id: "1y", label: "1Y", days: 252 },
  { id: "all", label: "All", days: Infinity },
] as const;

/** The portfolio against the S&P 500, both starting at 100 at the beginning of the chosen range. */
function PerformanceChart({
  t,
  bench,
}: {
  t: Terminal;
  bench: Extract<BenchmarkResult, { available: true }> | null;
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("1y");
  const data = useMemo(() => {
    const dates = bench ? bench.curves.dates : t.equity.map((e) => e.date);
    const p = bench ? bench.curves.portfolio : t.equity.map((e) => e.value);
    const b = bench ? bench.curves.benchmark : null;
    const r = RANGES.find((x) => x.id === range)!;
    let start = 0;
    if (r.days === null) {
      const year = dates.at(-1)?.slice(0, 4);
      const i = dates.findLastIndex((d) => d.slice(0, 4) < (year ?? ""));
      start = Math.max(0, i);
    } else if (Number.isFinite(r.days)) start = Math.max(0, dates.length - 1 - r.days);
    const step = Math.max(1, Math.ceil((dates.length - start) / 260));
    const out: { date: string; You: number; "S&P 500"?: number }[] = [];
    for (let i = start; i < dates.length; i += step) {
      out.push({
        date: dates[i]!,
        You: Math.round((p[i]! / p[start]!) * 1000) / 10,
        ...(b ? { "S&P 500": Math.round((b[i]! / b[start]!) * 1000) / 10 } : {}),
      });
    }
    if (out.at(-1)?.date !== dates.at(-1) && dates.length)
      out.push({
        date: dates.at(-1)!,
        You: Math.round((p.at(-1)! / p[start]!) * 1000) / 10,
        ...(b ? { "S&P 500": Math.round((b.at(-1)! / b[start]!) * 1000) / 10 } : {}),
      });
    return out;
  }, [t, bench, range]);
  const last = data.at(-1);
  return (
    <Panel
      title={bench ? "You vs the S&P 500" : "Your portfolio"}
      label="Performance chart"
      className="lg:col-span-2"
      action={
        <div role="group" aria-label="Chart range" className="flex rounded-lg border p-0.5 text-xs">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={range === r.id}
              onClick={() => setRange(r.id)}
              className={cn(
                "rounded-md px-2 py-0.5",
                range === r.id
                  ? "bg-muted font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      }
    >
      {last && (
        <p className="mb-2 text-xs text-muted-foreground">
          Each line starts at 100. Now: you{" "}
          <span className="font-medium text-foreground tabular-nums">{last.You.toFixed(1)}</span>
          {last["S&P 500"] !== undefined && (
            <>
              , S&amp;P 500{" "}
              <span className="font-medium text-foreground tabular-nums">
                {last["S&P 500"].toFixed(1)}
              </span>
            </>
          )}
          .
        </p>
      )}
      <div className="h-64" role="img" aria-label="Chart: portfolio value against the S&P 500">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={axisTick}
              minTickGap={48}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={axisTick}
              width={40}
              domain={["auto", "auto"]}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="You"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            {bench && (
              <Line
                type="monotone"
                dataKey="S&P 500"
                stroke="var(--muted-foreground)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

/** A word and a shape for each severity, so colour is never the only cue. */
const SEVERITY_STYLE: Record<Insight["severity"], { label: string; icon: string; color: string }> =
  {
    alert: { label: "Alert", icon: "▲", color: "text-loss" },
    watch: { label: "Watch", icon: "●", color: "text-warn" },
    info: { label: "Note", icon: "○", color: "text-info" },
  };
const SEVERITY_ORDER: Record<Insight["severity"], number> = { alert: 0, watch: 1, info: 2 };

export function Dashboard() {
  return <WithPortfolio>{(id) => <PortfolioView id={id} />}</WithPortfolio>;
}

function PortfolioView({ id }: { id: string }) {
  const { data: t, error } = useApi<Terminal>(`/api/portfolios/${id}/terminal`);
  const { data: insights } = useApi<{ insights: Insight[] }>(`/api/portfolios/${id}/insights`);
  const { data: radar } = useApi<Radar>(`/api/portfolios/${id}/radar?days=7`);
  const { data: benchRaw } = useApi<BenchmarkResult>(`/api/portfolios/${id}/benchmark`);
  const bench = benchRaw && benchRaw.available ? benchRaw : null;

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (!t) return <Loading />;
  const perf = (label: string) => t.performance.find((p) => p.label === label)?.value ?? null;
  const ytd = perf("Year to date");
  const month = perf("1 month");
  const topForce =
    // Only when every holding is profiled: the summary speaks for the whole portfolio.
    t.exposures.available && t.exposures.coverage >= 0.999 && t.exposures.topFactors[0]
      ? { name: t.exposures.topFactors[0].name, share: t.exposures.topFactors[0].share }
      : null;
  const summary = summarize({
    monthReturn: month,
    holdings: t.holdings,
    topForce,
    curves: bench?.curves ?? null,
  });
  const spyMonth = bench ? trailingReturn(bench.curves.benchmark, 21) : null;
  const spyYtd = bench ? yearToDate(bench.curves.dates, bench.curves.benchmark) : null;
  const drivers = contributions(t.holdings).slice(0, 6);
  const maxDriver = Math.max(0.0001, ...drivers.map((d) => Math.abs(d.points)));
  const risks = [...(insights?.insights ?? [])].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  return (
    <div className="space-y-5">
      <GettingStarted />

      <section
        aria-label="Summary"
        data-tour="summary"
        className="rounded-2xl border bg-gradient-to-br from-card to-muted/60 p-6 text-card-foreground"
      >
        <p className="text-xs font-medium text-muted-foreground">
          {t.portfolio.name} · prices to {t.asOf}
        </p>
        <h2
          className={cn(
            "mt-2 flex items-center gap-2 text-3xl font-semibold tracking-tight",
            summary.tone === "gain" ? "text-gain" : summary.tone === "loss" ? "text-loss" : "",
          )}
        >
          {summary.tone === "gain" && <ArrowUpRight className="size-7" aria-hidden="true" />}
          {summary.tone === "loss" && <ArrowDownRight className="size-7" aria-hidden="true" />}
          {summary.headline}
        </h2>
        {summary.lines.length > 0 && (
          <ul className="mt-3 max-w-3xl space-y-1 text-[0.95rem] leading-relaxed text-foreground/85">
            {summary.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-label="Key figures"
        data-tour="kpis"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <Figure
          label="1 month"
          value={month === null ? "n/a" : signed(month)}
          valueClass={tone(month)}
          note={spyMonth === null ? undefined : `S&P 500 ${signed(spyMonth)}`}
          explain="Change in your portfolio's value over the last 21 trading days."
        />
        <Figure
          label={ytd === null ? "Whole window" : "Year to date"}
          value={signed(ytd ?? perf("Whole window") ?? 0)}
          valueClass={tone(ytd ?? perf("Whole window"))}
          note={ytd !== null && spyYtd !== null ? `S&P 500 ${signed(spyYtd)}` : undefined}
          explain="Change since the end of last year, or over all the history we have."
        />
        <Figure
          label="Ups and downs"
          value={pct(t.risk.volatility)}
          note={`${calmness(t.risk.volatility)} · volatility, per year`}
          explain="How much the value typically swings in a year (annualized volatility). Lower is calmer."
        />
        <Figure
          label="Worst fall"
          value={signed(t.risk.maxDrawdown)}
          valueClass="text-loss"
          note="Max drawdown: biggest drop from a peak"
          explain="The largest fall from a high point to a later low in this window."
        />
        <details className="col-span-2 rounded-2xl border bg-card px-4 py-2 text-sm lg:col-span-4">
          <summary className="cursor-pointer text-xs text-muted-foreground">More figures</summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 pb-2 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Portfolio index</dt>
              <dd className="font-semibold tabular-nums">
                {t.index.value.toFixed(1)}{" "}
                <span className={cn("text-xs font-normal", tone(t.index.dayChange))}>
                  {signed(t.index.dayChange, 2)} today
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Sharpe</dt>
              <dd className="font-semibold tabular-nums" title="Return per unit of risk">
                {t.risk.sharpe.toFixed(2)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Up days</dt>
              <dd className="font-semibold tabular-nums">{pct(t.risk.upDayShare, 0)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Bad day (1 in 20)</dt>
              <dd className="font-semibold tabular-nums">{signed(-Math.abs(t.risk.var95), 2)}</dd>
            </div>
          </dl>
        </details>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <PerformanceChart t={t} bench={bench} />
        <Panel title="What drove the last month" label="Drivers">
          {drivers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Not enough history yet.</p>
          ) : (
            <ul className="space-y-2.5 text-sm" aria-label="Contribution by holding">
              {drivers.map((d) => (
                <li
                  key={d.ticker}
                  className="grid grid-cols-[3.5rem_1fr_4.5rem] items-center gap-2"
                >
                  <span className="font-medium">{d.ticker}</span>
                  <span className="relative h-2 rounded-full bg-muted" aria-hidden="true">
                    <span
                      className={cn(
                        "absolute top-0 h-2 rounded-full",
                        d.points >= 0 ? "left-1/2 bg-gain" : "right-1/2 bg-loss",
                      )}
                      style={{ width: `${(Math.abs(d.points) / maxDriver) * 50}%` }}
                    />
                  </span>
                  <span className={cn("text-right tabular-nums", tone(d.points))}>
                    {d.points >= 0 ? "+" : "−"}
                    {Math.abs(d.points * 100).toFixed(2)} pts
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            About each holding&rsquo;s share of the month: its weight times its 1-month return.
          </p>
        </Panel>
      </div>

      <section aria-label="What to know now" data-tour="insights" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Risks and signals to watch</h2>
          <span className="text-xs text-muted-foreground">Most important first</span>
        </div>
        {!insights ? (
          <Loading />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Insights">
            {risks.slice(0, 6).map((i) => {
              const s = SEVERITY_STYLE[i.severity];
              return (
                <li key={i.id}>
                  <Link
                    href={i.href}
                    className={cn(
                      "group flex h-full flex-col gap-1.5 rounded-2xl border bg-card p-4 text-card-foreground transition-colors hover:bg-muted/50",
                      i.severity === "alert" && "border-loss/40",
                      i.severity === "watch" && "border-warn/40",
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <span
                        className={cn("text-[0.7rem] leading-none", s.color)}
                        aria-hidden="true"
                      >
                        {s.icon}
                      </span>
                      {s.label}
                    </span>
                    <h3 className="leading-snug font-semibold">{i.title}</h3>
                    <p className="flex-1 text-sm text-muted-foreground">{i.detail}</p>
                    <span className="mt-1 inline-flex items-center gap-0.5 text-sm font-medium">
                      {i.linkLabel}
                      <ChevronRight
                        className="size-4 transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Panel
        title="Your holdings"
        label="Holdings"
        action={
          <Link
            href="/terminal"
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Full detail in the Terminal
          </Link>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Holdings snapshot">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Holding</th>
                <th className="py-2 pr-3 font-medium">Weight</th>
                <th className="py-2 pr-3 text-right font-medium">Today</th>
                <th className="py-2 pr-3 text-right font-medium">1 month</th>
                <th className="hidden py-2 pr-3 font-medium md:table-cell">60 days</th>
                <th className="hidden py-2 text-right font-medium sm:table-cell">
                  Share of ups and downs
                </th>
              </tr>
            </thead>
            <tbody>
              {[...t.holdings]
                .sort((a, b) => b.weight - a.weight)
                .map((h) => (
                  <tr key={h.ticker} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <Link href={`/research/${h.ticker}`} className="font-medium hover:underline">
                        {h.ticker}
                      </Link>
                      <div className="max-w-28 truncate text-xs text-muted-foreground sm:max-w-48">
                        {h.name}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="w-10 tabular-nums">{pct(h.weight, 0)}</span>
                        <span
                          className="hidden h-1.5 w-20 rounded-full bg-muted sm:block"
                          aria-hidden="true"
                        >
                          <span
                            className="block h-1.5 rounded-full bg-primary/70"
                            style={{ width: `${Math.max(3, Math.min(100, h.weight * 100 * 2))}%` }}
                          />
                        </span>
                      </div>
                    </td>
                    <td className={cn("py-2 pr-3 text-right tabular-nums", tone(h.d1))}>
                      {h.d1 === null ? "n/a" : signed(h.d1, 2)}
                    </td>
                    <td className={cn("py-2 pr-3 text-right tabular-nums", tone(h.m1))}>
                      {h.m1 === null ? "n/a" : signed(h.m1)}
                    </td>
                    <td className="hidden py-2 pr-3 md:table-cell">
                      <Sparkline values={h.sparkline} />
                    </td>
                    <td className="hidden py-2 text-right tabular-nums sm:table-cell">
                      <span
                        className={cn(
                          h.riskShare / h.weight >= 1.5 &&
                            h.riskShare >= 0.1 &&
                            "font-semibold text-warn",
                        )}
                      >
                        {pct(h.riskShare, 0)}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Share of ups and downs is how much of the portfolio&rsquo;s volatility each holding
          accounts for; it is highlighted when it is well above the holding&rsquo;s weight.
        </p>
      </Panel>

      <MovePanel portfolioId={id} />

      <section aria-label="Top news" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Top news for this portfolio</h2>
          <Link
            href="/news"
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            All news and how they are ranked
          </Link>
        </div>
        {!radar ? (
          <Loading />
        ) : radar.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No news matched your holdings in the last 7 days. Scan the web for news on the News
            page.
          </p>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-3" aria-label="Top news">
            {radar.items.slice(0, 3).map((n) => (
              <li key={n.url}>
                <NewsCard item={n} compact />
              </li>
            ))}
          </ul>
        )}
      </section>

      <ExplainPanel portfolioId={id} />

      <p className="text-xs text-muted-foreground">
        {t.window.from} to {t.window.to} ({t.window.tradingDays} trading days). Constant target
        weights, rebalanced daily. Risk-free rate 0.0%. Past figures, not predictions.
      </p>
    </div>
  );
}
