"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ApiError } from "@/lib/api";
import { pct, signedPct } from "@/lib/format";
import type { PortfolioAnalytics } from "@/server/portfolios";

interface Summary {
  id: string;
  name: string;
}

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
  const [list, setList] = useState<Summary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<{
    id: string;
    data?: PortfolioAnalytics;
    error?: string;
  } | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The session cookie is set by the layout bootstrap; retry once if this races it.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await api<{ portfolios: Summary[] }>("/api/portfolios");
          if (cancelled) return;
          setList(r.portfolios);
          setSelected(r.portfolios[0]?.id ?? null);
          return;
        } catch (e) {
          if (attempt === 1 || !(e instanceof ApiError && e.status === 401)) {
            if (!cancelled) setListError(e instanceof Error ? e.message : "Failed to load");
            return;
          }
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    api<PortfolioAnalytics>(`/api/portfolios/${selected}/analytics`)
      .then((data) => !cancelled && setResult({ id: selected, data }))
      .catch(
        (e) =>
          !cancelled &&
          setResult({ id: selected, error: e instanceof Error ? e.message : "Failed to load" }),
      );
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const current = result?.id === selected ? result : null;
  const data = current?.data ?? null;
  const error = listError ?? current?.error ?? null;

  if (list && list.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">You have no portfolios yet.</p>
        <Button render={<Link href="/portfolios/new" />}>Create a portfolio</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        {list && list.length > 1 && (
          <select
            aria-label="Portfolio"
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={selected ?? ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <Button variant="outline" size="sm" render={<Link href="/portfolios/new" />}>
          New portfolio
        </Button>
      </div>

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
                    <TableHead>Name</TableHead>
                    <TableHead>Sector</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.holdings.map((h) => (
                    <TableRow key={h.ticker}>
                      <TableCell className="font-medium">{h.ticker}</TableCell>
                      <TableCell>{h.name}</TableCell>
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
