"use client";

import { useState } from "react";
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
import type { CorrelationWindow, PortfolioCorrelation } from "@/server/correlation";
import { WithPortfolio } from "./with-portfolio";

const windows: { value: CorrelationWindow; label: string }[] = [
  { value: "6m", label: "6 months" },
  { value: "1y", label: "1 year" },
  { value: "3y", label: "3 years" },
];

const fmt = (x: number) => x.toFixed(2);

/** Diverging cell colour; the number is always printed so colour is never the only signal. */
function cellStyle(rho: number, diagonal: boolean): React.CSSProperties {
  if (diagonal) return { backgroundColor: "var(--muted)" };
  return {
    backgroundColor: `color-mix(in oklab, var(${rho >= 0 ? "--info" : "--loss"}) ${Math.round(Math.min(1, Math.abs(rho)) * 55)}%, transparent)`,
  };
}

export function CorrelationView() {
  return <WithPortfolio>{(id) => <Content id={id} />}</WithPortfolio>;
}

function Content({ id }: { id: string }) {
  const [window, setWindow] = useState<CorrelationWindow>("1y");
  const { data, error } = useApi<PortfolioCorrelation>(
    `/api/portfolios/${id}/correlation?window=${window}`,
  );

  return (
    <div className="space-y-6">
      <div className="flex gap-2" role="group" aria-label="Window">
        {windows.map((w) => (
          <button
            key={w.value}
            type="button"
            aria-pressed={window === w.value}
            onClick={() => setWindow(w.value)}
            className={`rounded-md border px-3 py-1 text-sm ${window === w.value ? "bg-muted font-medium" : ""}`}
          >
            {w.label}
          </button>
        ))}
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
            {data.window.limitedBy && `, limited by ${data.window.limitedBy} price history`}. Daily
            simple returns, Pearson correlation.
          </p>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Average pairwise correlation
                </CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">
                {fmt(data.averagePairwise)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Diversification ratio
                </CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">
                {data.diversificationRatio.toFixed(2)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Average correlation on worst days
                </CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">
                {data.stress ? fmt(data.stress.averagePairwise) : "n/a"}
                {data.stress ? (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {data.stress.days} days (worst {Math.round(data.stress.fraction * 100)}% for the
                    portfolio)
                  </span>
                ) : (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    needs a longer window
                  </span>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Correlation matrix</CardTitle>
            </CardHeader>
            <CardContent
              className="overflow-x-auto"
              role="region"
              aria-label="Correlation matrix, scrollable"
              tabIndex={0}
            >
              <table
                className="border-separate border-spacing-1 text-sm"
                aria-label="Correlation matrix"
              >
                <thead>
                  <tr>
                    <th />
                    {data.order.map((j) => (
                      <th key={j} scope="col" className="px-2 font-medium">
                        {data.tickers[j]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.order.map((i) => (
                    <tr key={i}>
                      <th scope="row" className="pr-2 text-right font-medium">
                        {data.tickers[i]}
                      </th>
                      {data.order.map((j) => (
                        <td
                          key={j}
                          className="min-w-14 rounded px-2 py-2 text-center tabular-nums"
                          style={cellStyle(data.matrix[i]![j]!, i === j)}
                          title={`${data.tickers[i]} / ${data.tickers[j]}: ${fmt(data.matrix[i]![j]!)}`}
                        >
                          {fmt(data.matrix[i]![j]!)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-sm text-muted-foreground">
                Historical correlation is not the same as shared economic exposure: two stocks can
                be uncorrelated now and still share the same vulnerability to a future shock.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Correlation with the portfolio</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticker</TableHead>
                    <TableHead className="text-right">Correlation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...data.withPortfolio]
                    .sort((a, b) => b.correlation - a.correlation)
                    .map((r) => (
                      <TableRow key={r.ticker}>
                        <TableCell className="font-medium">{r.ticker}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(r.correlation)}
                        </TableCell>
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
