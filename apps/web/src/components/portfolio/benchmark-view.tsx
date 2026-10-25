"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HowToRead } from "@/components/ui/how-to-read";
import { Loading } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { axisTick, chartColors, tooltipStyle } from "@/lib/chart";
import { pct, signedPct } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { BenchmarkResult } from "@/server/benchmark";
import { ExplainTool } from "./explain-tool";
import { WithPortfolio } from "./with-portfolio";

export function BenchmarkView() {
  return <WithPortfolio>{(id) => <Content key={id} id={id} />}</WithPortfolio>;
}

const n2 = (x: number | null) => (x === null ? "n/a" : x.toFixed(2));

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border bg-card p-3 shadow-xs">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{note}</div>
    </div>
  );
}

function Content({ id }: { id: string }) {
  const { data, error } = useApi<BenchmarkResult>(`/api/portfolios/${id}/benchmark`);
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!data) return <Loading rows={2} />;
  if (!data.available)
    return (
      <Card>
        <CardContent>
          <p>
            {data.reason === "no_benchmark"
              ? "No market benchmark prices are loaded yet, so there is nothing to compare with."
              : "There is not enough shared price history with the market to compare yet."}
          </p>
        </CardContent>
      </Card>
    );

  const s = data.stats;
  const curve = data.curves.dates.map((date, i) => ({
    date,
    portfolio: data.curves.portfolio[i],
    benchmark: data.curves.benchmark[i],
  }));
  const beta = s.beta;
  const reading =
    beta === null
      ? "The market barely moved, so a beta cannot be measured."
      : `When the market moved 1%, your portfolio typically moved ${beta.toFixed(2)}%. ${
          beta > 1.1
            ? "It amplifies the market."
            : beta < 0.9
              ? "It is calmer than the market."
              : "It moves about like the market."
        }`;

  return (
    <div className="space-y-6">
      <HowToRead>
        <p>
          This page compares your portfolio with the {data.benchmark.name} over{" "}
          {data.window.tradingDays} trading days. It answers three questions: how much does my
          portfolio move when the market moves (beta), did I earn anything beyond what that market
          exposure explains (alpha), and how closely do I follow the market (tracking error).
        </p>
        <p>
          Capture ratios split the story: <strong>up capture</strong> shows how much of the
          market&apos;s good days you got, and <strong>down capture</strong> how much of its bad
          days you took. Below 100% on down days and near or above 100% on up days is the pattern
          investors hope for. Alpha from a few years of data is noisy: do not read it as skill.
        </p>
      </HowToRead>

      <p className="font-medium" data-testid="beta-reading">
        {reading}
      </p>

      <div
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        role="group"
        aria-label="Market comparison"
      >
        <Stat label="Beta" value={n2(s.beta)} note="move per 1% market move" />
        <Stat
          label="Alpha (a year)"
          value={s.alpha === null ? "n/a" : signedPct(s.alpha, 1)}
          note="return beyond beta"
        />
        <Stat
          label="Correlation"
          value={n2(s.correlation)}
          note={s.rSquared === null ? "" : `market explains ${pct(s.rSquared, 0)}`}
        />
        <Stat
          label="Tracking error"
          value={s.trackingError === null ? "n/a" : pct(s.trackingError, 1)}
          note="how far you stray"
        />
        <Stat
          label="Up capture"
          value={s.upCapture === null ? "n/a" : pct(s.upCapture, 0)}
          note="of the market's up days"
        />
        <Stat
          label="Down capture"
          value={s.downCapture === null ? "n/a" : pct(s.downCapture, 0)}
          note="of the market's down days"
        />
        <Stat
          label="Information ratio"
          value={n2(s.informationRatio)}
          note="extra return per unit of straying"
        />
        <Stat label="Beat the market" value={pct(s.battingAverage, 0)} note="of days" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Growth of 100: you and the market</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curve} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  minTickGap={56}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  domain={["auto", "auto"]}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  tickFormatter={(v: number) => v.toFixed(0)}
                />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => Number(v).toFixed(1)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  name="Your portfolio"
                  dataKey="portfolio"
                  dot={false}
                  strokeWidth={2.5}
                  stroke={chartColors.info}
                  isAnimationActive={false}
                />
                <Line
                  name={data.benchmark.name}
                  dataKey="benchmark"
                  dot={false}
                  strokeWidth={1.5}
                  stroke="var(--chart-3)"
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Beta over the trailing {Math.round(126 / 21)} months</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {data.rollingBeta.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Not enough history for a rolling beta yet.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={data.rollingBeta}
                  margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    minTickGap={56}
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    tickFormatter={(v: number) => v.toFixed(1)}
                  />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => Number(v).toFixed(2)} />
                  <ReferenceLine
                    y={1}
                    stroke={chartColors.axis}
                    strokeDasharray="4 4"
                    label={{ value: "market", fill: chartColors.axis, fontSize: 11 }}
                  />
                  <Line
                    name="Beta"
                    dataKey="value"
                    dot={false}
                    strokeWidth={2}
                    stroke="var(--chart-4)"
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Year by year</CardTitle>
        </CardHeader>
        <CardContent>
          <Table aria-label="Calendar-year returns">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Year</TableHead>
                <TableHead scope="col" className="text-right">
                  Your portfolio
                </TableHead>
                <TableHead scope="col" className="text-right">
                  {data.benchmark.name}
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Difference
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.years.map((y) => (
                <TableRow key={y.year}>
                  <TableCell>
                    {y.year}
                    {y.partial && (
                      <span className="ml-1 text-xs text-muted-foreground">(part year)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {signedPct(y.portfolio, 1)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {signedPct(y.benchmark, 1)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${y.portfolio >= y.benchmark ? "text-gain" : "text-loss"}`}
                  >
                    {signedPct(y.portfolio - y.benchmark, 1)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ExplainTool portfolioId={id} tool="benchmark" params={{}} label="Explain this comparison" />
      <p className="max-w-3xl text-xs text-muted-foreground">
        Computed from {data.window.tradingDays} daily returns ({data.window.from} to{" "}
        {data.window.to}) with constant target weights. Past behavior does not predict future
        results. Research information, not advice.
      </p>
    </div>
  );
}
