"use client";

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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApi } from "@/lib/use-api";
import { ExplainPanel } from "./explain-panel";
import { WithPortfolio } from "./with-portfolio";
import { pct, signedPct } from "@/lib/format";
import type { PortfolioAnalytics } from "@/server/portfolios";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="text-2xl font-semibold">{value}</CardContent>
    </Card>
  );
}

export function Dashboard() {
  return <WithPortfolio>{(id) => <PortfolioView id={id} />}</WithPortfolio>;
}

function PortfolioView({ id }: { id: string }) {
  const { data, error } = useApi<PortfolioAnalytics>(`/api/portfolios/${id}/analytics`);

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!data && !error && <p className="text-muted-foreground">Loading</p>}
      {data && (
        <>
          <p className="text-sm text-muted-foreground">
            {data.window.from} to {data.window.to} ({data.window.tradingDays} trading days)
            {data.window.limitedBy && `, limited by ${data.window.limitedBy} price history`}.
            Constant target weights, rebalanced daily. Risk-free rate{" "}
            {pct(data.stats.riskFreeAnnual)}.
          </p>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Stat label="Total return" value={signedPct(data.stats.totalReturn)} />
            <Stat label="Annualized return" value={signedPct(data.stats.annualizedReturn)} />
            <Stat label="Volatility (ann.)" value={pct(data.stats.annualizedVolatility)} />
            <Stat label="Max drawdown" value={pct(data.stats.maxDrawdown)} />
            <Stat label="Sharpe" value={data.stats.sharpe.toFixed(2)} />
          </div>

          <ExplainPanel portfolioId={id} />

          <Card>
            <CardHeader>
              <CardTitle>Growth of 1.00</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.equityCurve}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" minTickGap={48} fontSize={12} />
                  <YAxis
                    domain={["auto", "auto"]}
                    fontSize={12}
                    tickFormatter={(v: number) => v.toFixed(2)}
                  />
                  <Tooltip formatter={(v) => Number(v).toFixed(3)} />
                  <Line
                    type="monotone"
                    dataKey="value"
                    dot={false}
                    strokeWidth={2}
                    stroke="currentColor"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Drawdown</CardTitle>
              </CardHeader>
              <CardContent className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.drawdown}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" minTickGap={48} fontSize={12} />
                    <YAxis fontSize={12} tickFormatter={(v: number) => pct(v, 0)} />
                    <Tooltip formatter={(v) => pct(Number(v), 2)} />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="currentColor"
                      fill="currentColor"
                      fillOpacity={0.15}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Sector allocation</CardTitle>
              </CardHeader>
              <CardContent className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.sectors} layout="vertical" margin={{ left: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" fontSize={12} tickFormatter={(v: number) => pct(v, 0)} />
                    <YAxis type="category" dataKey="sector" fontSize={12} width={120} />
                    <Tooltip formatter={(v) => pct(Number(v))} />
                    <Bar dataKey="weight" fill="currentColor" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>
                Holdings (effective number of positions {data.concentration.effectiveN.toFixed(1)},
                largest {pct(data.concentration.topWeight, 0)})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticker</TableHead>
                    <TableHead className="hidden sm:table-cell">Name</TableHead>
                    <TableHead>Sector</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.holdings.map((h) => (
                    <TableRow key={h.ticker}>
                      <TableCell className="font-medium">{h.ticker}</TableCell>
                      <TableCell className="hidden sm:table-cell">{h.name}</TableCell>
                      <TableCell>{h.sector ?? "Unclassified"}</TableCell>
                      <TableCell className="text-right">{pct(h.weight)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
