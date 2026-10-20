"use client";

import Link from "next/link";
import { useEffect } from "react";
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
import { pct } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { Terminal } from "@/server/terminal";
import { WithPortfolio } from "./with-portfolio";

const AMBER = "#ffb000";
const GREEN = "#4ade80";
const RED = "#ff7b7b";

const signed = (x: number, d = 2) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;
const tone = (x: number | null) =>
  x === null
    ? "text-neutral-400"
    : x > 0
      ? "text-emerald-400"
      : x < 0
        ? "text-rose-400"
        : "text-neutral-300";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The Terminal is dark; this switches the whole app to the dark theme while the page is open. */
function useDarkTheme() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
    return () => document.documentElement.classList.remove("dark");
  }, []);
}

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
    <section className={`border border-neutral-800 bg-neutral-950 ${className}`}>
      <header className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900 px-2 py-1">
        <h2 className="text-xs font-semibold tracking-wider text-amber-400 uppercase">{title}</h2>
        <Link
          href={`/guide#${about}`}
          aria-label={`About ${title}`}
          className="rounded px-1.5 text-xs text-neutral-300 underline hover:text-amber-400"
        >
          ?
        </Link>
      </header>
      <div className="p-2">{children}</div>
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
      className="h-6 w-24"
      role="img"
      aria-label={`60-day price trend, ${up ? "up" : "down"}`}
    >
      <polyline fill="none" stroke={up ? GREEN : RED} strokeWidth="1.5" points={points} />
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
    <tr className="border-b border-neutral-900 last:border-0">
      <th scope="row" className="py-1 pr-2 text-left font-normal text-neutral-400">
        {label}
      </th>
      <td className={`py-1 text-right tabular-nums ${valueClass}`}>{value}</td>
    </tr>
  );
}

export function TerminalView() {
  useDarkTheme();
  return <WithPortfolio>{(id) => <Content id={id} />}</WithPortfolio>;
}

function Content({ id }: { id: string }) {
  const { data: t, error } = useApi<Terminal>(`/api/portfolios/${id}/terminal`);
  if (error) {
    return (
      <p role="alert" className="text-sm text-rose-400">
        {error}
      </p>
    );
  }
  if (!t) return <p className="text-neutral-400">Loading</p>;

  const years = [...new Set(t.monthly.map((m) => m.month.slice(0, 4)))];
  const monthCell = (y: string, m: number) =>
    t.monthly.find((x) => x.month === `${y}-${String(m + 1).padStart(2, "0")}`);

  return (
    <div className="space-y-2 font-mono text-xs">
      <Panel title={t.portfolio.name} about="terminal" className="">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span
            className="text-2xl font-semibold text-neutral-100 tabular-nums"
            aria-label="Portfolio index"
          >
            {t.index.value.toFixed(2)}
          </span>
          <span
            className={`text-base tabular-nums ${tone(t.index.dayChange)}`}
            aria-label="Day change"
          >
            {signed(t.index.dayChange)}
          </span>
          <span className="text-neutral-400">
            As of {t.asOf} | {t.window.tradingDays} trading days from {t.window.from} | index = 100
            at the start | constant target weights, prices adjusted for splits
          </span>
        </div>
      </Panel>

      <div className="grid gap-2 lg:grid-cols-12">
        <Panel title="Portfolio index" about="terminal-index" className="lg:col-span-8">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={t.equity}>
                <CartesianGrid stroke="#262626" strokeDasharray="2 4" />
                <XAxis dataKey="date" minTickGap={60} tick={{ fill: "#a3a3a3", fontSize: 10 }} />
                <YAxis
                  domain={["auto", "auto"]}
                  tick={{ fill: "#a3a3a3", fontSize: 10 }}
                  tickFormatter={(v: number) => v.toFixed(0)}
                  width={36}
                />
                <Tooltip
                  contentStyle={{ background: "#0a0a0a", border: "1px solid #404040" }}
                  formatter={(v) => Number(v).toFixed(2)}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  dot={false}
                  stroke={AMBER}
                  strokeWidth={1.5}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
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
      </div>

      <Panel title="Holdings monitor" about="terminal-holdings">
        <div
          className="overflow-x-auto"
          role="region"
          aria-label="Holdings monitor, scrollable"
          tabIndex={0}
        >
          <table className="w-full min-w-[640px]" aria-label="Holdings monitor">
            <thead>
              <tr className="text-left text-neutral-400">
                <th className="py-1 font-normal">Ticker</th>
                <th className="py-1 font-normal">Sector</th>
                <th className="py-1 text-right font-normal">Weight</th>
                <th className="py-1 text-right font-normal">Price</th>
                <th className="py-1 text-right font-normal">1D</th>
                <th className="py-1 text-right font-normal">1W</th>
                <th className="py-1 text-right font-normal">1M</th>
                <th className="py-1 text-right font-normal">Share of risk</th>
                <th className="py-1 pl-3 font-normal">60 days</th>
              </tr>
            </thead>
            <tbody>
              {t.holdings.map((h) => (
                <tr key={h.ticker} className="border-t border-neutral-900">
                  <th scope="row" className="py-1 text-left font-semibold text-amber-300">
                    {h.ticker}
                  </th>
                  <td className="py-1 text-neutral-300">{h.sector}</td>
                  <td className="py-1 text-right tabular-nums">{pct(h.weight)}</td>
                  <td className="py-1 text-right tabular-nums">{h.price.toFixed(2)}</td>
                  <td className={`py-1 text-right tabular-nums ${tone(h.d1)}`}>
                    {h.d1 === null ? "n/a" : signed(h.d1)}
                  </td>
                  <td className={`py-1 text-right tabular-nums ${tone(h.d5)}`}>
                    {h.d5 === null ? "n/a" : signed(h.d5)}
                  </td>
                  <td className={`py-1 text-right tabular-nums ${tone(h.m1)}`}>
                    {h.m1 === null ? "n/a" : signed(h.m1)}
                  </td>
                  <td
                    className={`py-1 text-right tabular-nums ${h.riskShare > h.weight * 1.25 ? "text-amber-300" : ""}`}
                  >
                    {pct(h.riskShare)}
                  </td>
                  <td className="py-1 pl-3">
                    <Sparkline values={h.sparkline} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-neutral-400">
          Amber share of risk means a holding adds more than 25% above its weight to portfolio risk.
        </p>
      </Panel>

      <div className="grid gap-2 lg:grid-cols-12">
        <Panel title="Risk" about="terminal-risk" className="lg:col-span-4">
          <table className="w-full">
            <tbody>
              <Kv label="Volatility (annualized)" value={pct(t.risk.volatility)} />
              <Kv label="Sharpe ratio" value={t.risk.sharpe.toFixed(2)} />
              <Kv
                label="Max drawdown"
                value={signed(t.risk.maxDrawdown)}
                valueClass="text-rose-400"
              />
              <Kv label="1-day VaR 95%" value={signed(t.risk.var95)} valueClass="text-rose-400" />
              <Kv label="1-day VaR 99%" value={signed(t.risk.var99)} valueClass="text-rose-400" />
              <Kv
                label="Expected shortfall 95%"
                value={signed(t.risk.expectedShortfall95)}
                valueClass="text-rose-400"
              />
              <Kv
                label={`Best day (${t.risk.best.date})`}
                value={signed(t.risk.best.value)}
                valueClass="text-emerald-400"
              />
              <Kv
                label={`Worst day (${t.risk.worst.date})`}
                value={signed(t.risk.worst.value)}
                valueClass="text-rose-400"
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
                    <span className="text-amber-300">{h.ticker}</span>
                    <span className="tabular-nums text-neutral-300">
                      weight {pct(h.weight, 0)} | risk {pct(h.riskShare, 0)}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 bg-neutral-800" aria-hidden="true">
                    <div
                      className="h-1.5 bg-neutral-500"
                      style={{ width: `${Math.max(0, Math.min(100, h.weight * 100))}%` }}
                    />
                  </div>
                  <div className="mt-0.5 h-1.5 bg-neutral-800" aria-hidden="true">
                    <div
                      className="h-1.5 bg-amber-400"
                      style={{ width: `${Math.max(0, Math.min(100, h.riskShare * 100))}%` }}
                    />
                  </div>
                </li>
              ))}
          </ul>
          <p className="mt-1 text-neutral-400">
            Grey is the weight, amber is the share of portfolio variance.
          </p>
        </Panel>

        <Panel
          title="Daily return distribution"
          about="terminal-distribution"
          className="lg:col-span-4"
        >
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={t.histogram.map((b) => ({ x: ((b.from + b.to) / 2) * 100, count: b.count }))}
              >
                <CartesianGrid stroke="#262626" strokeDasharray="2 4" />
                <XAxis
                  dataKey="x"
                  tick={{ fill: "#a3a3a3", fontSize: 10 }}
                  tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                  minTickGap={24}
                />
                <YAxis tick={{ fill: "#a3a3a3", fontSize: 10 }} width={28} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "#0a0a0a", border: "1px solid #404040" }}
                  formatter={(v) => `${v} days`}
                  labelFormatter={(v) => `${Number(v).toFixed(2)}%`}
                />
                <Bar dataKey="count" fill={AMBER} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 lg:grid-cols-12">
        <Panel title="Rolling 21-day volatility" about="terminal-rolling" className="lg:col-span-6">
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={t.rollingVolatility.map((r) => ({ date: r.date, value: r.value * 100 }))}
              >
                <CartesianGrid stroke="#262626" strokeDasharray="2 4" />
                <XAxis dataKey="date" minTickGap={60} tick={{ fill: "#a3a3a3", fontSize: 10 }} />
                <YAxis
                  tick={{ fill: "#a3a3a3", fontSize: 10 }}
                  tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                  width={36}
                />
                <Tooltip
                  contentStyle={{ background: "#0a0a0a", border: "1px solid #404040" }}
                  formatter={(v) => `${Number(v).toFixed(1)}%`}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={AMBER}
                  fill={AMBER}
                  fillOpacity={0.15}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Monthly returns" about="terminal-monthly" className="lg:col-span-6">
          <div
            className="overflow-x-auto"
            role="region"
            aria-label="Monthly returns, scrollable"
            tabIndex={0}
          >
            <table className="w-full min-w-[520px]" aria-label="Monthly returns">
              <thead>
                <tr className="text-neutral-400">
                  <th className="py-0.5 text-left font-normal">Year</th>
                  {MONTHS.map((m) => (
                    <th key={m} className="py-0.5 text-right font-normal">
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <tr key={y}>
                    <th scope="row" className="py-0.5 text-left font-normal text-neutral-300">
                      {y}
                    </th>
                    {MONTHS.map((_, m) => {
                      const c = monthCell(y, m);
                      return (
                        <td
                          key={m}
                          className="px-1 py-0.5 text-right tabular-nums"
                          style={
                            c
                              ? {
                                  backgroundColor: `${c.return >= 0 ? "rgba(74,222,128," : "rgba(255,123,123,"}${Math.min(0.45, Math.abs(c.return) * 4)})`,
                                }
                              : undefined
                          }
                        >
                          {c ? `${c.return >= 0 ? "+" : ""}${(c.return * 100).toFixed(1)}` : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-neutral-400">
            Percent per calendar month, compounded from daily returns.
          </p>
        </Panel>
      </div>

      <div className="grid gap-2 lg:grid-cols-12">
        <Panel title="Worst drawdowns" about="terminal-drawdowns" className="lg:col-span-4">
          {t.drawdowns.length === 0 ? (
            <p className="text-neutral-400">No decline from a peak in this window.</p>
          ) : (
            <table className="w-full" aria-label="Worst drawdowns">
              <thead>
                <tr className="text-left text-neutral-400">
                  <th className="py-0.5 font-normal">Depth</th>
                  <th className="py-0.5 font-normal">Peak</th>
                  <th className="py-0.5 font-normal">Trough</th>
                  <th className="py-0.5 font-normal">Recovered</th>
                </tr>
              </thead>
              <tbody>
                {t.drawdowns.map((d) => (
                  <tr key={d.peak} className="border-t border-neutral-900">
                    <td className="py-0.5 text-rose-400 tabular-nums">{signed(d.depth)}</td>
                    <td className="py-0.5">{d.peak}</td>
                    <td className="py-0.5">{d.trough}</td>
                    <td className="py-0.5">{d.recovery ?? "not yet"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Correlation" about="terminal-correlation" className="lg:col-span-4">
          {t.correlation === null ? (
            <p className="text-neutral-400">Needs at least two holdings.</p>
          ) : (
            <>
              <p>
                Average pairwise{" "}
                <span className="tabular-nums text-neutral-100">
                  {t.correlation.average.toFixed(2)}
                </span>
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

        <Panel title="Hidden exposure" about="terminal-exposure" className="lg:col-span-4">
          {!t.exposures.available ? (
            <p className="text-neutral-400">
              {t.exposures.reason === "no_factors"
                ? "No exposure data for these holdings."
                : "Some holdings have no exposure data yet."}
            </p>
          ) : (
            <>
              <p>
                Effective sectors{" "}
                <span className="tabular-nums text-neutral-100">
                  {t.exposures.effectiveSectors.toFixed(1)}
                </span>{" "}
                | effective factors{" "}
                <span className="tabular-nums text-neutral-100">
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
                Full analysis
              </Link>
            </>
          )}
        </Panel>
      </div>

      <Panel title="Relevant news" about="terminal-news">
        {t.news.length === 0 ? (
          <p className="text-neutral-400">No news matched your holdings in the last 7 days.</p>
        ) : (
          <ul className="space-y-1" aria-label="Relevant news">
            {t.news.map((n) => (
              <li key={n.url} className="flex gap-3">
                <span
                  className="w-10 shrink-0 text-right tabular-nums text-amber-300"
                  aria-label={`Relevance ${n.score.toFixed(1)} out of 10`}
                >
                  {n.score.toFixed(1)}
                </span>
                <span className="min-w-0">
                  <a href={n.url} target="_blank" rel="noopener noreferrer" className="underline">
                    {n.title}
                  </a>
                  <span className="text-neutral-400">
                    {" "}
                    | {n.tickers.join(", ")} | {n.class ?? "not yet classified"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/news" className="mt-1 inline-block underline">
          All news
        </Link>
      </Panel>
    </div>
  );
}
