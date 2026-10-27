"use client";

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
import type { ForceReturns } from "@/server/forces";
import { WithPortfolio } from "./with-portfolio";

export function ForcesView() {
  return <WithPortfolio>{(id) => <Content key={id} id={id} />}</WithPortfolio>;
}

function Content({ id }: { id: string }) {
  const { data, error } = useApi<ForceReturns>(`/api/portfolios/${id}/forces`);
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!data) return <Loading rows={2} />;
  if (!data.available)
    return (
      <Card data-tour="forces-attribution">
        <CardContent>
          <p>
            {data.reason === "missing_exposures"
              ? `This needs an exposure profile for every holding. Missing: ${data.missingTickers.join(", ")}.`
              : "Not enough companies with exposure profiles and prices to estimate what each force did."}
          </p>
        </CardContent>
      </Card>
    );

  const a = data.attribution;
  const chart = [
    ...data.forces
      .filter((f) => f.portfolioNet !== 0)
      .map((f) => ({ name: f.name, value: f.contribution })),
    { name: "Market-wide", value: a.market },
    { name: "Not explained", value: a.residual },
  ];
  const edge = data.fit.exposures - data.fit.sectors;

  return (
    <div className="space-y-6">
      <HowToRead>
        <p>
          Every day, all the companies in the index are lined up by how much each depends on each
          hidden force, and a regression finds how much extra the stocks that depend on a force
          moved. That number is the force&apos;s return for the day, for example &ldquo;stocks that
          depend on oil moved 0.2% more than stocks that do not&rdquo;. Added up over a year it
          shows what each force really did.
        </p>
        <p>
          Your portfolio&apos;s return is then split into what each force contributed, a market-wide
          part that lifted every stock, and a part the exposure scores do not explain. The parts add
          up exactly to the portfolio&apos;s summed daily returns.
        </p>
        <p>
          The scores are AI drafts, forces that tend to appear together are hard to tell apart, and
          a force with a small t-statistic did not move reliably. This describes the past year.
        </p>
      </HowToRead>

      <Card data-tour="forces-attribution">
        <CardHeader>
          <CardTitle>Where {data.portfolio.name}&apos;s return came from</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p data-testid="forces-summary" className="text-sm">
            Over {data.window.days} trading days ({data.window.from} to {data.window.to}) the
            portfolio&apos;s daily returns summed to {signedPct(a.total, 1)}:{" "}
            {signedPct(a.forces, 1)} from the hidden forces it depends on, {signedPct(a.market, 1)}{" "}
            market-wide and {signedPct(a.residual, 1)} not explained by the exposure scores.
          </p>
          <div
            role="group"
            aria-label="Contribution to return by force"
            style={{ height: Math.max(200, chart.length * 30) }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} layout="vertical" margin={{ left: 110 }}>
                <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" />
                <XAxis type="number" tick={axisTick} tickFormatter={(v: number) => pct(v, 0)} />
                <YAxis type="category" dataKey="name" tick={axisTick} width={160} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => signedPct(Number(v), 1)} />
                <Bar dataKey="value" isAnimationActive={false}>
                  {chart.map((c) => (
                    <Cell key={c.name} fill={c.value >= 0 ? chartColors.gain : chartColors.loss} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What each force did</CardTitle>
        </CardHeader>
        <CardContent>
          <Table aria-label="What each force did">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Force</TableHead>
                <TableHead scope="col" className="text-right">
                  Your net exposure
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Force return per exposure point
                </TableHead>
                <TableHead scope="col" className="text-right">
                  t-statistic
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Contribution to you
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.forces.map((f) => (
                <TableRow key={f.slug}>
                  <TableCell className="font-medium">{f.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {f.portfolioNet >= 0 ? "+" : ""}
                    {f.portfolioNet.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {signedPct(f.cumulative, 1)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {f.t === null ? "n/a" : f.t.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {signedPct(f.contribution, 1)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">
            A t-statistic beyond 2 (or below -2) means the force moved reliably in one direction
            over the year.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Do the exposure scores describe the market better than sectors?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p data-testid="forces-fit">
            On an average day across {data.universe.stocks} stocks, the {data.universe.forces}{" "}
            exposure scores explain {pct(data.fit.exposures, 1)} of the differences between stocks,
            against {pct(data.fit.sectors, 1)} for sector labels alone.{" "}
            {edge > 0
              ? `The exposure scores did better on ${pct(data.fit.daysExposuresBetter, 0)} of days.`
              : "Sector labels did at least as well."}
          </p>
          <p className="text-xs text-muted-foreground">
            Both figures are adjusted for how many columns each model uses, but both are fitted on
            the same day they are measured on, and daily stock moves are mostly noise, so small
            shares are normal.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
