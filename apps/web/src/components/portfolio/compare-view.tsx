"use client";

import Link from "next/link";
import { useState } from "react";
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
import { buttonVariants } from "@/components/ui/button";
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
import type { Comparison, CompareSide } from "@/server/compare";

interface Summary {
  id: string;
  name: string;
}

export function CompareView() {
  const { data: list, error } = useApi<{ portfolios: Summary[] }>("/api/portfolios");
  const [pickA, setPickA] = useState<string | null>(null);
  const [pickB, setPickB] = useState<string | null>(null);
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!list) return <Loading />;
  if (list.portfolios.length < 2)
    return (
      <Card>
        <CardContent className="space-y-3">
          <p>
            Comparing needs at least two portfolios. Load the five samples, or create another one.
          </p>
          <Link href="/portfolios/new" className={buttonVariants()}>
            Add a portfolio
          </Link>
        </CardContent>
      </Card>
    );
  const a = pickA ?? list.portfolios[0]!.id;
  const b = pickB ?? list.portfolios[1]!.id;
  return (
    <div className="space-y-6">
      <HowToRead>
        <p>
          Pick any two of your portfolios to see them side by side over the period both have prices
          for. Green marks the better value in each row: higher return and Sharpe ratio, lower
          volatility, a shallower worst fall. &ldquo;Better&rdquo; here only describes the past, not
          which one to own.
        </p>
        <p>
          The overlap shows how much money sits in companies both portfolios hold. Two portfolios
          can share no companies and still move together if they depend on the same economic forces,
          which is what the correlation and the forces rows reveal.
        </p>
      </HowToRead>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {(
          [
            ["First portfolio", a, setPickA],
            ["Second portfolio", b, setPickB],
          ] as const
        ).map(([label, value, set]) => (
          <label key={label} className="flex items-center gap-2">
            {label}
            <select
              aria-label={label}
              value={value}
              onChange={(e) => set(e.target.value)}
              className="h-8 rounded-lg border bg-background px-2.5 font-medium shadow-xs"
            >
              {list.portfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {a === b ? (
        <p role="alert" className="text-sm text-destructive">
          Choose two different portfolios.
        </p>
      ) : (
        <Result key={`${a}-${b}`} a={a} b={b} />
      )}
    </div>
  );
}

type Row = {
  label: string;
  get: (s: CompareSide) => number | null;
  fmt: (v: number) => string;
  /** Which direction counts as better; omitted when neither does. */
  better?: "high" | "low";
};

const ROWS: Row[] = [
  { label: "Holdings", get: (s) => s.holdings, fmt: (v) => String(v) },
  {
    label: "Yearly return",
    get: (s) => s.annualReturn,
    fmt: (v) => signedPct(v, 1),
    better: "high",
  },
  { label: "Volatility", get: (s) => s.volatility, fmt: (v) => pct(v, 1), better: "low" },
  { label: "Worst fall", get: (s) => s.maxDrawdown, fmt: (v) => pct(v, 1), better: "high" },
  { label: "Sharpe ratio", get: (s) => s.sharpe, fmt: (v) => v.toFixed(2), better: "high" },
  {
    label: "Effective sectors",
    get: (s) => s.effectiveSectors,
    fmt: (v) => v.toFixed(1),
    better: "high",
  },
  {
    label: "Effective forces",
    get: (s) => s.effectiveFactors,
    fmt: (v) => v.toFixed(1),
    better: "high",
  },
  { label: "Market beta", get: (s) => s.beta, fmt: (v) => v.toFixed(2) },
];

function Result({ a, b }: { a: string; b: string }) {
  const { data, error } = useApi<Comparison>(`/api/compare?a=${a}&b=${b}`);
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!data) return <Loading rows={2} />;
  const curve = data.curves.dates.map((date, i) => ({
    date,
    a: data.curves.a[i],
    b: data.curves.b[i],
  }));
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Side by side</CardTitle>
        </CardHeader>
        <CardContent>
          <Table aria-label="Side by side">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Measure</TableHead>
                <TableHead scope="col" className="text-right">
                  {data.a.name}
                </TableHead>
                <TableHead scope="col" className="text-right">
                  {data.b.name}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROWS.map((r) => {
                const [va, vb] = [r.get(data.a), r.get(data.b)];
                const win =
                  r.better && va !== null && vb !== null && va !== vb
                    ? (r.better === "high") === va > vb
                      ? "a"
                      : "b"
                    : null;
                const cell = (v: number | null, side: "a" | "b") => (
                  <TableCell
                    className={`text-right tabular-nums ${win === side ? "font-semibold text-gain" : ""}`}
                  >
                    {v === null ? "n/a" : r.fmt(v)}
                  </TableCell>
                );
                return (
                  <TableRow key={r.label}>
                    <TableCell>{r.label}</TableCell>
                    {cell(va, "a")}
                    {cell(vb, "b")}
                  </TableRow>
                );
              })}
              <TableRow>
                <TableCell>Biggest economic force</TableCell>
                {[data.a, data.b].map((s) => (
                  <TableCell key={s.id} className="text-right">
                    {s.topForce ? `${s.topForce.name} (${pct(s.topForce.share, 0)})` : "n/a"}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What differs</CardTitle>
        </CardHeader>
        <CardContent>
          <ul aria-label="Differences" className="list-disc space-y-1.5 pl-5 text-sm">
            {data.differences.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Growth of 100</CardTitle>
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
                  name={data.a.name}
                  dataKey="a"
                  dot={false}
                  strokeWidth={2}
                  stroke={chartColors.info}
                  isAnimationActive={false}
                />
                <Line
                  name={data.b.name}
                  dataKey="b"
                  dot={false}
                  strokeWidth={2}
                  stroke="var(--chart-3)"
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Overlap</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p data-testid="overlap-summary">
              {pct(data.overlap.sharedWeight, 0)} of the money is in companies both hold.
              {data.correlation !== null &&
                ` Daily return correlation: ${data.correlation.toFixed(2)}.`}
            </p>
            {data.overlap.shared.length > 0 && (
              <Table aria-label="Shared holdings">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Company</TableHead>
                    <TableHead scope="col" className="text-right">
                      {data.a.name}
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      {data.b.name}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.overlap.shared.map((s) => (
                    <TableRow key={s.ticker}>
                      <TableCell className="font-medium">{s.ticker}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(s.a, 1)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(s.b, 1)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
      <p className="max-w-3xl text-xs text-muted-foreground">
        Over {data.window.tradingDays} trading days ({data.window.from} to {data.window.to}), the
        dates both portfolios have prices for, with constant target weights. Past behavior does not
        predict future results. Research information, not advice.
      </p>
    </div>
  );
}
