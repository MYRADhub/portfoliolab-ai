"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { NewsCard } from "@/components/news/news-card";
import { axisTick, chartColors, tooltipStyle } from "@/lib/chart";
import { pct } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import type { Terminal } from "@/server/terminal";
import type { Radar } from "@/server/radar";
import { WithPortfolio } from "./with-portfolio";

const signed = (x: number, d = 2) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;
const tone = (x: number | null) =>
  x === null ? "text-muted-foreground" : x > 0 ? "text-gain" : x < 0 ? "text-loss" : "";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TABS = [
  { id: "overview", label: "Overview", key: "1" },
  { id: "risk", label: "Risk", key: "2" },
  { id: "calendar", label: "Calendar", key: "3" },
  { id: "context", label: "Context", key: "4" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const tabFromHash = (): TabId => {
  const h = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  return TABS.some((t) => t.id === h) ? (h as TabId) : "overview";
};

/** A titled box. On desktop it fills its grid cell; anything that does not fit scrolls inside the box, never the page. */
function Panel({
  title,
  about,
  className = "",
  children,
}: {
  title: string;
  about: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-md border bg-card text-card-foreground",
        className,
      )}
    >
      <header className="flex shrink-0 items-center justify-between border-b bg-muted px-2 py-1">
        <h2 className="text-xs font-semibold tracking-wider text-warn uppercase">{title}</h2>
        <Link
          href={`/guide#${about}`}
          aria-label={`About ${title}`}
          className="rounded px-1.5 text-xs underline hover:text-warn"
        >
          ?
        </Link>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-2">{children}</div>
    </section>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * 100).toFixed(2)},${(22 - ((v - min) / span) * 20).toFixed(2)}`,
    )
    .join(" ");
  const up = values.at(-1)! >= values[0]!;
  return (
    <svg
      viewBox="0 0 100 24"
      className="h-5 w-20"
      role="img"
      aria-label={`60-day price trend, ${up ? "up" : "down"}`}
    >
      <polyline
        fill="none"
        stroke={up ? chartColors.gain : chartColors.loss}
        strokeWidth="1.5"
        points={points}
      />
    </svg>
  );
}

function Kv({
  label,
  value,
  valueClass = "",
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <tr className="border-b last:border-0">
      <th scope="row" className="py-0.5 pr-2 text-left font-normal text-muted-foreground">
        {label}
      </th>
      <td className={`py-0.5 text-right tabular-nums ${valueClass}`}>{value}</td>
    </tr>
  );
}

const ChartBox = ({ children }: { children: React.ReactElement }) => (
  <div className="h-full min-h-[120px]">
    <ResponsiveContainer width="100%" height="100%">
      {children}
    </ResponsiveContainer>
  </div>
);

export function TerminalView() {
  return <WithPortfolio>{(id) => <Content id={id} />}</WithPortfolio>;
}

function Content({ id }: { id: string }) {
  const { data: t, error } = useApi<Terminal>(`/api/portfolios/${id}/terminal`);
  const { data: radar } = useApi<Radar>(`/api/portfolios/${id}/radar?days=7`);
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const select = (next: TabId, focus = false) => {
    setTab(next);
    window.history.replaceState(null, "", `#${next}`);
    if (focus) tabRefs.current[next]?.focus();
  };

  useEffect(() => {
    // Back, forward and edits to the address keep the visible section in step with the hash.
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        (el && ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName))
      )
        return;
      const found = TABS.find((x) => x.key === e.key);
      if (found) {
        setTab(found.id);
        window.history.replaceState(null, "", `#${found.id}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (error) {
    return (
      <p role="alert" className="text-sm text-loss">
        {error}
      </p>
    );
  }
  if (!t) return <p className="text-muted-foreground">Loading</p>;

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End")
      return;
    e.preventDefault();
    const n =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? TABS.length - 1
          : (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    select(TABS[n]!.id, true);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 font-mono text-xs">
      <header className="flex shrink-0 flex-wrap items-baseline gap-x-6 gap-y-1 rounded-md border bg-card px-3 py-2">
        <span className="text-sm font-semibold tracking-wider text-warn uppercase">
          {t.portfolio.name}
        </span>
        <span className="text-2xl font-semibold tabular-nums" aria-label="Portfolio index">
          {t.index.value.toFixed(2)}
        </span>
        <span
          className={`text-base tabular-nums ${tone(t.index.dayChange)}`}
          aria-label="Day change"
        >
          {signed(t.index.dayChange)}
        </span>
        <span className="text-muted-foreground">
          As of {t.asOf} | {t.window.tradingDays} trading days from {t.window.from} | index = 100 at
          the start | constant target weights
        </span>
      </header>

      <div role="tablist" aria-label="Terminal sections" className="flex shrink-0 gap-1 border-b">
        {TABS.map((x, i) => (
          <button
            key={x.id}
            ref={(el) => {
              tabRefs.current[x.id] = el;
            }}
            id={`tab-${x.id}`}
            role="tab"
            type="button"
            aria-selected={tab === x.id}
            aria-controls={`panel-${x.id}`}
            tabIndex={tab === x.id ? 0 : -1}
            onClick={() => select(x.id)}
            onKeyDown={(e) => onTabKey(e, i)}
            className={cn(
              "-mb-px rounded-t-md border border-b-0 px-3 py-1.5 text-xs font-semibold tracking-wider uppercase",
              tab === x.id
                ? "border-border bg-card text-warn"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <span
              className="mr-1.5 rounded border px-1 text-[10px] font-normal text-muted-foreground"
              aria-hidden="true"
            >
              {x.key}
            </span>
            {x.label}
          </button>
        ))}
        <span className="ml-auto self-center pr-1 text-muted-foreground">
          Keys 1-4 switch sections
        </span>
      </div>

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="min-h-0 flex-1"
      >
        {tab === "overview" && <Overview t={t} />}
        {tab === "risk" && <RiskTab t={t} />}
        {tab === "calendar" && <CalendarTab t={t} />}
        {tab === "context" && <ContextTab t={t} radar={radar ?? null} />}
      </div>
    </div>
  );
}

const GRID = "grid h-full min-h-0 gap-2 lg:grid-cols-12";

function Overview({ t }: { t: Terminal }) {
  return (
    <div className={`${GRID} lg:grid-rows-[minmax(0,5fr)_minmax(0,4fr)]`}>
      <Panel title="Portfolio index" about="terminal-index" className="min-h-[200px] lg:col-span-8">
        <ChartBox>
          <LineChart data={t.equity}>
            <CartesianGrid stroke={chartColors.grid} strokeDasharray="2 4" />
            <XAxis dataKey="date" minTickGap={60} tick={axisTick} />
            <YAxis
              domain={["auto", "auto"]}
              tick={axisTick}
              tickFormatter={(v: number) => v.toFixed(0)}
              width={36}
            />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => Number(v).toFixed(2)} />
            <Line
              type="monotone"
              dataKey="value"
              dot={false}
              stroke={chartColors.warn}
              strokeWidth={1.75}
            />
          </LineChart>
        </ChartBox>
      </Panel>

      <Panel title="Performance" about="terminal-performance" className="lg:col-span-4">
        <table className="w-full">
          <tbody>
            {t.performance.map((p) => (
              <Kv
                key={p.label}
                label={p.label}
                value={p.value === null ? "n/a" : signed(p.value)}
                valueClass={tone(p.value)}
              />
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Holdings monitor" about="terminal-holdings" className="lg:col-span-12">
        <table className="w-full min-w-[640px]" aria-label="Holdings monitor">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-0.5 font-normal">Ticker</th>
              <th className="py-0.5 font-normal">Sector</th>
              <th className="py-0.5 text-right font-normal">Weight</th>
              <th className="py-0.5 text-right font-normal">Price</th>
              <th className="py-0.5 text-right font-normal">1D</th>
              <th className="py-0.5 text-right font-normal">1W</th>
              <th className="py-0.5 text-right font-normal">1M</th>
              <th className="py-0.5 text-right font-normal">Share of risk</th>
              <th className="py-0.5 pl-3 font-normal">60 days</th>
            </tr>
          </thead>
          <tbody>
            {t.holdings.map((h) => (
              <tr key={h.ticker} className="border-t">
                <th scope="row" className="py-0.5 text-left font-semibold text-warn">
                  {h.ticker}
                </th>
                <td className="py-0.5 text-muted-foreground">{h.sector}</td>
                <td className="py-0.5 text-right tabular-nums">{pct(h.weight)}</td>
                <td className="py-0.5 text-right tabular-nums">{h.price.toFixed(2)}</td>
                <td className={`py-0.5 text-right tabular-nums ${tone(h.d1)}`}>
                  {h.d1 === null ? "n/a" : signed(h.d1)}
                </td>
                <td className={`py-0.5 text-right tabular-nums ${tone(h.d5)}`}>
                  {h.d5 === null ? "n/a" : signed(h.d5)}
                </td>
                <td className={`py-0.5 text-right tabular-nums ${tone(h.m1)}`}>
                  {h.m1 === null ? "n/a" : signed(h.m1)}
                </td>
                <td
                  className={`py-0.5 text-right tabular-nums ${h.riskShare > h.weight * 1.25 ? "font-semibold text-warn" : ""}`}
                >
                  {pct(h.riskShare)}
                </td>
                <td className="py-0.5 pl-3">
                  <Sparkline values={h.sparkline} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-muted-foreground">
          Amber share of risk: the holding adds more than 25% above its weight to portfolio risk.
        </p>
      </Panel>
    </div>
  );
}

function RiskTab({ t }: { t: Terminal }) {
  return (
    <div className={`${GRID} lg:grid-rows-2`}>
      <Panel title="Risk" about="terminal-risk" className="lg:col-span-4">
        <table className="w-full">
          <tbody>
            <Kv label="Volatility (annualized)" value={pct(t.risk.volatility)} />
            <Kv label="Sharpe ratio" value={t.risk.sharpe.toFixed(2)} />
            <Kv label="Max drawdown" value={signed(t.risk.maxDrawdown)} valueClass="text-loss" />
            <Kv label="1-day VaR 95%" value={signed(t.risk.var95)} valueClass="text-loss" />
            <Kv label="1-day VaR 99%" value={signed(t.risk.var99)} valueClass="text-loss" />
            <Kv
              label="Expected shortfall 95%"
              value={signed(t.risk.expectedShortfall95)}
              valueClass="text-loss"
            />
            <Kv
              label={`Best day (${t.risk.best.date})`}
              value={signed(t.risk.best.value)}
              valueClass="text-gain"
            />
            <Kv
              label={`Worst day (${t.risk.worst.date})`}
              value={signed(t.risk.worst.value)}
              valueClass="text-loss"
            />
            <Kv label="Days up" value={pct(t.risk.upDayShare, 0)} />
          </tbody>
        </table>
      </Panel>

      <Panel title="Risk versus weight" about="terminal-risk-weight" className="lg:col-span-4">
        <ul className="space-y-1.5" aria-label="Risk versus weight">
          {[...t.holdings]
            .sort((a, b) => b.riskShare - a.riskShare)
            .map((h) => (
              <li key={h.ticker}>
                <div className="flex justify-between">
                  <span className="font-semibold text-warn">{h.ticker}</span>
                  <span className="tabular-nums text-muted-foreground">
                    weight {pct(h.weight, 0)} | risk {pct(h.riskShare, 0)}
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 rounded bg-muted" aria-hidden="true">
                  <div
                    className="h-1.5 rounded bg-muted-foreground/60"
                    style={{ width: `${Math.max(0, Math.min(100, h.weight * 100))}%` }}
                  />
                </div>
                <div className="mt-0.5 h-1.5 rounded bg-muted" aria-hidden="true">
                  <div
                    className="h-1.5 rounded bg-warn"
                    style={{ width: `${Math.max(0, Math.min(100, h.riskShare * 100))}%` }}
                  />
                </div>
              </li>
            ))}
        </ul>
        <p className="mt-1 text-muted-foreground">
          Grey is the weight, amber is the share of portfolio variance.
        </p>
      </Panel>

      <Panel title="Rolling 21-day volatility" about="terminal-rolling" className="lg:col-span-4">
        <ChartBox>
          <AreaChart
            data={t.rollingVolatility.map((r) => ({ date: r.date, value: r.value * 100 }))}
          >
            <CartesianGrid stroke={chartColors.grid} strokeDasharray="2 4" />
            <XAxis dataKey="date" minTickGap={60} tick={axisTick} />
            <YAxis tick={axisTick} tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={36} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${Number(v).toFixed(1)}%`} />
            <Area
              type="monotone"
              dataKey="value"
              stroke={chartColors.warn}
              fill={chartColors.warn}
              fillOpacity={0.15}
            />
          </AreaChart>
        </ChartBox>
      </Panel>

      <Panel title="Worst drawdowns" about="terminal-drawdowns" className="lg:col-span-6">
        {t.drawdowns.length === 0 ? (
          <p className="text-muted-foreground">No decline from a peak in this window.</p>
        ) : (
          <table className="w-full" aria-label="Worst drawdowns">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-0.5 font-normal">Depth</th>
                <th className="py-0.5 font-normal">Peak</th>
                <th className="py-0.5 font-normal">Trough</th>
                <th className="py-0.5 font-normal">Recovered</th>
              </tr>
            </thead>
            <tbody>
              {t.drawdowns.map((d) => (
                <tr key={d.peak} className="border-t">
                  <td className="py-0.5 tabular-nums text-loss">{signed(d.depth)}</td>
                  <td className="py-0.5">{d.peak}</td>
                  <td className="py-0.5">{d.trough}</td>
                  <td className="py-0.5">{d.recovery ?? "not yet"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title="Daily return distribution"
        about="terminal-distribution"
        className="lg:col-span-6"
      >
        <ChartBox>
          <BarChart
            data={t.histogram.map((b) => ({ x: ((b.from + b.to) / 2) * 100, count: b.count }))}
          >
            <CartesianGrid stroke={chartColors.grid} strokeDasharray="2 4" />
            <XAxis
              dataKey="x"
              tick={axisTick}
              tickFormatter={(v: number) => `${v.toFixed(1)}%`}
              minTickGap={24}
            />
            <YAxis tick={axisTick} width={28} allowDecimals={false} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v) => `${v} days`}
              labelFormatter={(v) => `${Number(v).toFixed(2)}%`}
            />
            <Bar dataKey="count" fill={chartColors.warn} />
          </BarChart>
        </ChartBox>
      </Panel>
    </div>
  );
}

function CalendarTab({ t }: { t: Terminal }) {
  const years = [...new Set(t.monthly.map((m) => m.month.slice(0, 4)))];
  const cell = (y: string, m: number) =>
    t.monthly.find((x) => x.month === `${y}-${String(m + 1).padStart(2, "0")}`);
  const yearTotal = (y: string) =>
    t.monthly.filter((m) => m.month.startsWith(y)).reduce((g, m) => g * (1 + m.return), 1) - 1;
  const bg = (r: number) =>
    `color-mix(in oklab, var(${r >= 0 ? "--gain" : "--loss"}) ${Math.round(Math.min(0.5, Math.abs(r) * 5) * 100)}%, transparent)`;

  const list = (rows: { date: string; value: number }[], label: string) => (
    <ol aria-label={label} className="space-y-0.5">
      {rows.map((d) => (
        <li key={d.date} className="flex justify-between border-b py-0.5 last:border-0">
          <span>{d.date}</span>
          <span className={`tabular-nums ${tone(d.value)}`}>{signed(d.value)}</span>
        </li>
      ))}
    </ol>
  );

  return (
    <div className={`${GRID} lg:grid-rows-[minmax(0,1fr)]`}>
      <Panel title="Monthly returns" about="terminal-monthly" className="lg:col-span-8">
        <table className="w-full min-w-[560px]" aria-label="Monthly returns">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 text-left font-normal">Year</th>
              {MONTHS.map((m) => (
                <th key={m} className="py-1 text-right font-normal">
                  {m}
                </th>
              ))}
              <th className="py-1 pl-2 text-right font-normal">Year</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y}>
                <th scope="row" className="py-1 text-left font-normal">
                  {y}
                </th>
                {MONTHS.map((_, m) => {
                  const c = cell(y, m);
                  return (
                    <td
                      key={m}
                      className="px-1 py-1 text-right tabular-nums"
                      style={c ? { backgroundColor: bg(c.return) } : undefined}
                    >
                      {c ? `${c.return >= 0 ? "+" : ""}${(c.return * 100).toFixed(1)}` : ""}
                    </td>
                  );
                })}
                <td
                  className={`py-1 pl-2 text-right font-semibold tabular-nums ${tone(yearTotal(y))}`}
                >
                  {signed(yearTotal(y), 1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-muted-foreground">
          Percent per calendar month, compounded from daily returns. The last column is the whole
          year (or the part of it in the window).
        </p>
      </Panel>

      <div className="grid min-h-0 gap-2 lg:col-span-4 lg:grid-rows-2">
        <Panel title="Best days" about="terminal-extremes">
          {list(t.extremes.best, "Best days")}
        </Panel>
        <Panel title="Worst days" about="terminal-extremes">
          {list(t.extremes.worst, "Worst days")}
        </Panel>
      </div>
    </div>
  );
}

function ContextTab({ t, radar }: { t: Terminal; radar: Radar | null }) {
  return (
    <div className={`${GRID} lg:grid-rows-[minmax(0,auto)_minmax(0,1fr)]`}>
      <Panel title="Hidden exposure" about="terminal-exposure" className="lg:col-span-6">
        {!t.exposures.available ? (
          <p className="text-muted-foreground">
            {t.exposures.reason === "no_factors"
              ? "No exposure data for these holdings."
              : "Some holdings have no exposure data yet."}
          </p>
        ) : (
          <>
            <p>
              Effective sectors{" "}
              <span className="tabular-nums font-semibold">
                {t.exposures.effectiveSectors.toFixed(1)}
              </span>{" "}
              | effective factors{" "}
              <span className="tabular-nums font-semibold">
                {t.exposures.effectiveFactors === null
                  ? "n/a"
                  : t.exposures.effectiveFactors.toFixed(1)}
              </span>
            </p>
            <ul className="mt-1 space-y-0.5" aria-label="Largest factors">
              {t.exposures.topFactors.map((f) => (
                <li key={f.name} className="flex justify-between">
                  <span>{f.name}</span>
                  <span className="tabular-nums">{pct(f.share, 0)}</span>
                </li>
              ))}
            </ul>
            <Link href="/exposures" className="mt-1 inline-block underline">
              Full analysis and graph
            </Link>
          </>
        )}
      </Panel>

      <Panel title="Correlation" about="terminal-correlation" className="lg:col-span-6">
        {t.correlation === null ? (
          <p className="text-muted-foreground">Needs at least two holdings.</p>
        ) : (
          <>
            <p>
              Average pairwise{" "}
              <span className="tabular-nums font-semibold">{t.correlation.average.toFixed(2)}</span>
            </p>
            <ul className="mt-1 space-y-0.5" aria-label="Most correlated pairs">
              {t.correlation.topPairs.map((p) => (
                <li key={`${p.a}-${p.b}`} className="flex justify-between">
                  <span>
                    {p.a} / {p.b}
                  </span>
                  <span className="tabular-nums">{p.correlation.toFixed(2)}</span>
                </li>
              ))}
            </ul>
            <Link href="/correlation" className="mt-1 inline-block underline">
              Full matrix
            </Link>
          </>
        )}
      </Panel>

      <Panel title="Relevant news" about="terminal-news" className="lg:col-span-12">
        {radar === null ? (
          <p className="text-muted-foreground">Loading</p>
        ) : radar.items.length === 0 ? (
          <p className="text-muted-foreground">No news matched your holdings in the last 7 days.</p>
        ) : (
          <ul className="grid gap-2 lg:grid-cols-2" aria-label="Relevant news">
            {radar.items.slice(0, 4).map((n) => (
              <li key={n.url}>
                <NewsCard item={n} compact />
              </li>
            ))}
          </ul>
        )}
        <Link href="/news" className="mt-2 inline-block underline">
          All news
        </Link>
      </Panel>
    </div>
  );
}
