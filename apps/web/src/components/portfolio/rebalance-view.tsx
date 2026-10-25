"use client";

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
import type { Rebalance } from "@/server/rebalance";
import { ExplainTool } from "./explain-tool";
import { WithPortfolio } from "./with-portfolio";

const CAPS = [0.2, 0.25, 0.3, 0.4, 0.5];
const COLORS: Record<string, string> = {
  current: chartColors.info,
  equal: "var(--chart-2)",
  min_variance: "var(--chart-3)",
  risk_parity: "var(--chart-4)",
  min_exposure: "var(--chart-5)",
};

export function RebalanceView() {
  return <WithPortfolio>{(id) => <Content key={id} id={id} />}</WithPortfolio>;
}

function Content({ id }: { id: string }) {
  const [cap, setCap] = useState(0.4);
  const { data, error } = useApi<Rebalance>(`/api/portfolios/${id}/rebalance?maxWeight=${cap}`);

  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!data) return <Loading rows={2} />;

  const tickers = data.strategies[0]!.weights.map((w) => w.ticker);
  const best = {
    vol: Math.min(...data.strategies.map((s) => s.volatility)),
    sharpe: Math.max(...data.strategies.map((s) => s.sharpe)),
    dd: Math.max(...data.strategies.map((s) => s.maxDrawdown)),
  };
  const curve = data.curves.dates.map((date, i) => ({
    date,
    ...Object.fromEntries(Object.entries(data.curves.series).map(([k, v]) => [k, v[i]])),
  }));

  return (
    <div className="space-y-6">
      <HowToRead>
        <p>
          This page asks: if the same holdings had been weighted differently over the last three
          years, would the ride have been smoother? It compares your weights with three simple
          alternatives built only from each holding&apos;s own price history.
        </p>
        <p>
          <strong>Lowest volatility</strong> finds the mix that moved up and down the least.{" "}
          <strong>Equal risk</strong> gives each holding the same share of the portfolio&apos;s ups
          and downs. <strong>Money moved</strong> is how much of your portfolio would change hands
          to get there. <strong>Smallest net exposure</strong> uses the exposure scores instead of
          prices: it finds the mix whose net dependence on every economic force is smallest, and
          &ldquo;effective forces&rdquo; shows how many independent forces each mix really rides. It
          works by cancelling opposite exposures, so it can raise volatility and reduce the number
          of effective forces: read every column, and remember it is only as good as the exposure
          scores, many of which are AI drafts. It appears only when every holding has an exposure
          profile.
        </p>
        <p>
          Every number looks backwards and was fitted on the same period it is measured on, so the
          alternatives look better than anyone could have known in advance. Use it to see what
          concentrates your risk, not to predict.
        </p>
      </HowToRead>

      <div
        role="group"
        aria-label="Largest position allowed"
        className="flex flex-wrap items-center gap-2 text-sm"
      >
        <span>No holding above</span>
        {CAPS.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={cap === c}
            onClick={() => setCap(c)}
            className={`rounded-md border px-3 py-1 ${cap === c ? "bg-accent font-medium text-accent-foreground" : ""}`}
          >
            {pct(c, 0)}
          </button>
        ))}
        <span className="text-muted-foreground">
          in the lowest-volatility mix (applied: {pct(data.maxWeight, 0)})
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Strategy comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <Table aria-label="Strategy comparison">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Strategy</TableHead>
                <TableHead scope="col" className="text-right">
                  Volatility
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Yearly return
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Sharpe
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Worst fall
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Effective positions
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Effective forces
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Money moved
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.strategies.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <span className="font-medium">{s.name}</span>
                    <span className="block text-xs text-muted-foreground">{s.description}</span>
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${s.volatility === best.vol ? "font-semibold text-gain" : ""}`}
                  >
                    {pct(s.volatility, 1)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {signedPct(s.annualReturn, 1)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${s.sharpe === best.sharpe ? "font-semibold text-gain" : ""}`}
                  >
                    {s.sharpe.toFixed(2)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${s.maxDrawdown === best.dd ? "font-semibold text-gain" : ""}`}
                  >
                    {pct(s.maxDrawdown, 1)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.effectiveN.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.effectiveFactors === null ? "n/a" : s.effectiveFactors.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.id === "current" ? "n/a" : pct(s.turnover, 0)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">
            Green marks the best value in each column.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Weights by strategy</CardTitle>
          </CardHeader>
          <CardContent>
            <Table aria-label="Weights by strategy">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Holding</TableHead>
                  {data.strategies.map((s) => (
                    <TableHead key={s.id} scope="col" className="text-right">
                      {s.name}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickers.map((t, i) => (
                  <TableRow key={t}>
                    <TableCell className="font-medium">{t}</TableCell>
                    {data.strategies.map((s) => (
                      <TableCell
                        key={s.id}
                        className="text-right tabular-nums"
                        title={`${pct(s.weights[i]!.riskShare, 0)} of this mix's ups and downs`}
                      >
                        {pct(s.weights[i]!.weight, 1)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-2 text-xs text-muted-foreground">
              Hover a weight to see its share of risk.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Growth of 100 over {data.window.tradingDays} trading days</CardTitle>
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
                {data.strategies.map((s) => (
                  <Line
                    key={s.id}
                    name={s.name}
                    dataKey={s.id}
                    dot={false}
                    strokeWidth={s.id === "current" ? 2.5 : 1.5}
                    stroke={COLORS[s.id]}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <ExplainTool
        portfolioId={id}
        tool="rebalance"
        params={{ maxWeight: cap }}
        label="Explain these results"
      />
      <p className="max-w-3xl text-xs text-muted-foreground">{data.caveat}</p>
    </div>
  );
}
