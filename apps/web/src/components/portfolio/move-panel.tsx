"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { chartColors, axisTick, tooltipStyle } from "@/lib/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { pct } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { ExplainResult } from "@/server/explain";
import type { PortfolioMove } from "@/server/move";
import { ExplanationBody } from "./explain-panel";
import { Loading } from "@/components/ui/skeleton";

const pp = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}`;
const move = (x: number) => `${pp(x)}%`;
const barColor = (x: number) => (x >= 0 ? chartColors.gain : chartColors.loss);

export function MovePanel({ portfolioId }: { portfolioId: string }) {
  const [chosen, setChosen] = useState<{ portfolioId: string; date: string } | null>(null);
  const date = chosen?.portfolioId === portfolioId ? chosen.date : null;
  const { data, error } = useApi<PortfolioMove>(
    `/api/portfolios/${portfolioId}/move${date ? `?date=${date}` : ""}`,
  );

  const [ai, setAi] = useState<{
    key: string;
    result?: ExplainResult;
    error?: string;
    busy?: boolean;
  } | null>(null);
  const aiKey = data ? `${portfolioId}:${data.date}` : "";
  const currentAi = ai?.key === aiKey ? ai : null;

  async function explain() {
    if (!data) return;
    const key = `${portfolioId}:${data.date}`;
    setAi({ key, busy: true });
    try {
      const result = await api<ExplainResult>(
        `/api/portfolios/${portfolioId}/move/explain?date=${data.date}`,
        { method: "POST" },
      );
      setAi({ key, result });
    } catch (e) {
      setAi({ key, error: e instanceof Error ? e.message : "Something went wrong" });
    }
  }

  return (
    <Card id="move" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Why did my portfolio move?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {!data && !error && <Loading />}
        {data && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground">Day</span>
                <select
                  aria-label="Day"
                  className="rounded-md border bg-background px-2 py-1"
                  value={data.date}
                  onChange={(e) => setChosen({ portfolioId, date: e.target.value })}
                >
                  {data.availableDates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <span className="text-2xl font-semibold" aria-label="Portfolio return that day">
                {move(data.portfolioReturn)}
              </span>
            </div>
            <p className="text-base">{data.headline}</p>

            <div style={{ height: Math.max(140, data.holdings.length * 34) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.holdings.map((h) => ({ ticker: h.ticker, pp: h.contribution * 100 }))}
                  layout="vertical"
                  margin={{ left: 8 }}
                >
                  <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    fontSize={12}
                    tickFormatter={(v: number) => `${v.toFixed(2)}`}
                  />
                  <YAxis type="category" dataKey="ticker" tick={axisTick} width={56} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v) => `${Number(v).toFixed(2)} percentage points`}
                  />
                  <Bar dataKey="pp">
                    {data.holdings.map((h) => (
                      <Cell key={h.ticker} fill={barColor(h.contribution)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <details>
              <summary className="cursor-pointer text-muted-foreground">
                Contribution tables by holding and by sector
              </summary>
              <div className="mt-3 space-y-4">
                <Table aria-label="Contribution by holding">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Holding</TableHead>
                      <TableHead className="text-right">Weight</TableHead>
                      <TableHead className="text-right">Stock return</TableHead>
                      <TableHead className="text-right">Contribution (pp)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.holdings.map((h) => (
                      <TableRow key={h.ticker}>
                        <TableCell className="font-medium">{h.ticker}</TableCell>
                        <TableCell className="text-right tabular-nums">{pct(h.weight)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {move(h.assetReturn)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {pp(h.contribution)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <Table aria-label="Contribution by sector">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sector</TableHead>
                      <TableHead className="text-right">Contribution (pp)</TableHead>
                      <TableHead className="text-right">Share of the move</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.groups.map((g) => (
                      <TableRow key={g.group}>
                        <TableCell className="font-medium whitespace-normal">{g.group}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {pp(g.contribution)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {g.share === null ? "n/a" : `${Math.round(g.share * 100)}%`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <p className="text-xs text-muted-foreground">
                  A share can be above 100% or negative when sectors moved in opposite directions:
                  the shares always add up to 100%.
                </p>
              </div>
            </details>

            <div>
              <h3 className="font-medium">News linked to your holdings</h3>
              {data.news.length === 0 ? (
                <p className="text-muted-foreground">No linked news found for this day.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {data.news.map((n) => (
                    <li key={n.url}>
                      <a
                        href={n.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        {n.title}
                      </a>
                      <div className="text-muted-foreground">
                        {n.tickers.join(", ")}
                        {n.source ? ` | ${n.source}` : ""}
                        {n.classification
                          ? ` | ${n.classification.class} (importance ${n.classification.fundamentalImportance} of 10)`
                          : " | not yet classified"}
                        {n.copies > 0 ? ` | ${n.copies} similar` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                News is matched to companies by name and may coincide with, not cause, a price move.
              </p>
            </div>

            <div className="space-y-3 border-t pt-4">
              <Button size="sm" onClick={() => void explain()} disabled={currentAi?.busy}>
                {currentAi?.busy
                  ? "Working"
                  : currentAi?.result
                    ? "Refresh explanation"
                    : "Explain this move"}
              </Button>
              {currentAi?.error && (
                <p role="alert" className="text-destructive">
                  {currentAi.error}
                </p>
              )}
              {currentAi?.result && <ExplanationBody result={currentAi.result} />}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
