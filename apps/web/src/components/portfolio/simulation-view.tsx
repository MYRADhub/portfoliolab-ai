"use client";

import { useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HowToRead } from "@/components/ui/how-to-read";
import { Loading } from "@/components/ui/skeleton";
import { axisTick, chartColors, tooltipStyle } from "@/lib/chart";
import { pct, signedPct } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { Simulation } from "@/server/simulation";
import { ExplainTool } from "./explain-tool";
import { WithPortfolio } from "./with-portfolio";

const YEARS = [1, 3, 5];

export function SimulationView() {
  return <WithPortfolio>{(id) => <Content key={id} id={id} />}</WithPortfolio>;
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-3 shadow-xs">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

function Content({ id }: { id: string }) {
  const [years, setYears] = useState(3);
  const [drift, setDrift] = useState<"typical" | "historical">("typical");
  const { data, error } = useApi<Simulation>(
    `/api/portfolios/${id}/simulation?years=${years}&drift=${drift === "typical" ? "0.07" : "historical"}`,
  );

  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!data) return <Loading rows={1} />;

  const s = data.summary;
  const chart = data.fan.map((f) => ({
    month: Math.round(f.day / 21),
    wide: [f.p5, f.p95],
    middle: [f.p25, f.p75],
    median: f.p50,
  }));
  const ret = (v: number) => signedPct(v / 100 - 1, 0);

  return (
    <div className="space-y-6">
      <HowToRead>
        <p>
          This page replays your portfolio&apos;s own recent daily returns in shuffled blocks to
          draw thousands of possible futures. The shaded bands show where most of them end up: the
          dark band holds the middle half of outcomes and the light band holds 90%.
        </p>
        <p>
          It is not a forecast. It assumes the next few years resemble the last three, so a calm or
          booming window makes the picture look safer than it may be. Read it as a way to feel the
          size of normal ups and downs.
        </p>
      </HowToRead>

      <div role="group" aria-label="Time horizon" className="flex items-center gap-2 text-sm">
        <span>Look ahead</span>
        {YEARS.map((y) => (
          <button
            key={y}
            type="button"
            aria-pressed={years === y}
            onClick={() => setYears(y)}
            className={`rounded-md border px-3 py-1 ${years === y ? "bg-accent font-medium text-accent-foreground" : ""}`}
          >
            {y} {y === 1 ? "year" : "years"}
          </button>
        ))}
        <span className="text-muted-foreground">
          {data.paths.toLocaleString("en-US")} simulated paths
        </span>
      </div>

      <div
        role="group"
        aria-label="Expected return"
        className="flex flex-wrap items-center gap-2 text-sm"
      >
        <span>Centre the paths on</span>
        <button
          type="button"
          aria-pressed={drift === "typical"}
          onClick={() => setDrift("typical")}
          className={`rounded-md border px-3 py-1 ${drift === "typical" ? "bg-accent font-medium text-accent-foreground" : ""}`}
        >
          A typical 7% a year
        </button>
        <button
          type="button"
          aria-pressed={drift === "historical"}
          onClick={() => setDrift("historical")}
          className={`rounded-md border px-3 py-1 ${drift === "historical" ? "bg-accent font-medium text-accent-foreground" : ""}`}
        >
          The past average ({signedPct(data.history.annualReturn, 0)} a year)
        </button>
        <span className="text-muted-foreground">
          {drift === "historical"
            ? "Assumes the last three years repeat."
            : "Keeps the portfolio's ups and downs but not its past boom."}
        </span>
      </div>

      <div
        className="grid grid-cols-2 gap-3 lg:grid-cols-6"
        role="group"
        aria-label="Simulation summary"
      >
        <Stat label="Typical outcome" value={ret(s.medianEnd)} note="median path" />
        <Stat label="Bad case" value={ret(s.p5End)} note="1 in 20 ends lower" tone="text-loss" />
        <Stat label="Good case" value={ret(s.p95End)} note="1 in 20 ends higher" tone="text-gain" />
        <Stat label="Chance of a loss" value={pct(s.probLoss, 0)} note="ends below the start" />
        <Stat label="Chance of losing 20%+" value={pct(s.probLoss20, 0)} />
        <Stat
          label="Typical worst drop"
          value={pct(s.medianMaxDrawdown, 0)}
          note="median path's biggest fall"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Possible paths of 100 invested today</CardTitle>
        </CardHeader>
        <CardContent className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="month"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                tickFormatter={(m: number) => `${m}m`}
                minTickGap={32}
              />
              <YAxis
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={(v: number) => v.toFixed(0)}
                domain={["auto", "auto"]}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v) =>
                  Array.isArray(v)
                    ? `${Number(v[0]).toFixed(0)} to ${Number(v[1]).toFixed(0)}`
                    : Number(v).toFixed(0)
                }
                labelFormatter={(m) => `Month ${m}`}
              />
              <Area
                dataKey="wide"
                name="90% of paths"
                stroke="none"
                fill={chartColors.info}
                fillOpacity={0.14}
                isAnimationActive={false}
              />
              <Area
                dataKey="middle"
                name="Middle half"
                stroke="none"
                fill={chartColors.info}
                fillOpacity={0.28}
                isAnimationActive={false}
              />
              <Line
                dataKey="median"
                name="Median"
                stroke={chartColors.info}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground" data-testid="sim-history">
        Built from {data.history.tradingDays} trading days ({data.history.from} to {data.history.to}
        ): historical return {signedPct(data.history.annualReturn, 1)} a year with volatility{" "}
        {pct(data.history.volatility, 1)}.
      </p>
      <ExplainTool
        portfolioId={id}
        tool="simulation"
        params={{ years, drift: drift === "typical" ? 0.07 : "historical" }}
        label="Explain these results"
      />
      <p className="max-w-3xl text-xs text-muted-foreground">{data.caveat}</p>
    </div>
  );
}
