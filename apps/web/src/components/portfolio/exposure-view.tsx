"use client";

import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
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
import { pct } from "@/lib/format";
import type { PortfolioExposures } from "@/server/exposures";
import { chartColors, axisTick, tooltipStyle } from "@/lib/chart";
import { ExposureGraph } from "./exposure-graph";
import { WithPortfolio } from "./with-portfolio";
import { HowToRead } from "@/components/ui/how-to-read";
import { EvidenceTable, PriceCheckCard, ScoreMethodCard } from "./score-method";
import { exposureProvenance } from "@/lib/provenance";
import { Loading } from "@/components/ui/skeleton";

export function ExposureView() {
  return <WithPortfolio>{(id) => <Content id={id} />}</WithPortfolio>;
}

function cellStyle(signed: number): React.CSSProperties {
  return {
    backgroundColor: `color-mix(in oklab, var(${signed >= 0 ? "--gain" : "--loss"}) ${Math.round((Math.abs(signed) / 3) * 55)}%, transparent)`,
  };
}

function Content({ id }: { id: string }) {
  const { data, error } = useApi<PortfolioExposures>(`/api/portfolios/${id}/exposures`);

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (!data) return <Loading />;

  if (!data.available) {
    return (
      <Card>
        <CardContent className="space-y-2">
          {data.reason === "no_factors" ? (
            <p>Exposure data has not been loaded yet, so there is nothing to analyze.</p>
          ) : (
            <p>
              Exposure profiles are missing for: <strong>{data.missingTickers.join(", ")}</strong>.
              The analysis needs every holding covered so it does not understate your risk.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  const c = data.concentration;
  const tickers = [...new Set(data.cells.map((x) => x.ticker))].sort();
  const factorSlugs = data.factors.map((f) => f.slug);
  const nameOf = (slug: string) => data.factors.find((f) => f.slug === slug)?.name ?? slug;
  const cell = (ticker: string, factor: string) =>
    data.cells.find((x) => x.ticker === ticker && x.factor === factor);

  return (
    <div className="space-y-6">
      <HowToRead>
        <p>
          Owning different stocks does not mean owning different risks. Each company depends on
          economic forces such as interest rates, oil prices or AI spending. This page adds those
          dependencies up across your holdings.
        </p>
        <p>
          The sector count shows how many groups you look spread across by industry; the force count
          shows how many independent economic forces you are really exposed to. When the force count
          is much smaller, your portfolio is less diversified than its sector mix suggests. The map
          shows which holdings are tied to which forces.
        </p>
      </HowToRead>
      {(() => {
        const draft = data.cells.filter((c) => exposureProvenance(c.rationale) === "draft").length;
        const illustrative = data.cells.filter(
          (c) => exposureProvenance(c.rationale) === "illustrative",
        ).length;
        if (draft + illustrative === 0) return null;
        return (
          <p
            role="note"
            className="rounded-lg border border-warn/50 bg-warn-soft px-3 py-2 text-sm"
          >
            {draft > 0 &&
              `${draft} of ${data.cells.length} exposure scores here are AI drafts that no person has reviewed. `}
            {illustrative > 0 &&
              `${illustrative} of ${data.cells.length} are illustrative placeholders. `}
            Treat the map as a starting point for questions, not as established fact.
          </p>
        );
      })()}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Effective sectors
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {c.effectiveSectors.toFixed(1)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Effective factors
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {c.effectiveFactors === null ? "n/a" : c.effectiveFactors.toFixed(1)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">Factor HHI</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {c.factorHhi === null ? "n/a" : c.factorHhi.toFixed(3)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Largest factor share
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {c.topFactorShare === null ? "n/a" : pct(c.topFactorShare, 0)}
          </CardContent>
        </Card>
      </div>
      <p className="text-sm text-muted-foreground">
        Effective counts are 1 / HHI. A portfolio that looks spread across sectors can still be
        concentrated in a few underlying factors. Exposure scores are judgments with stated
        confidence, not measurements.
      </p>

      <Card data-tour="exposure-map">
        <CardHeader>
          <CardTitle>Hidden exposure map</CardTitle>
        </CardHeader>
        <CardContent>
          <ExposureGraph
            holdings={data.holdings.map((h) => ({ ticker: h.ticker, weight: h.weight }))}
            factors={data.factors.map((f) => ({ slug: f.slug, name: f.name, net: f.net }))}
            cells={data.cells.map((c) => ({
              ticker: c.ticker,
              factor: c.factor,
              signed: c.signed,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Portfolio factor loadings (net)</CardTitle>
        </CardHeader>
        <CardContent style={{ height: Math.max(220, data.factors.length * 28) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.factors} layout="vertical" margin={{ left: 120 }}>
              <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" />
              <XAxis type="number" tick={axisTick} />
              <YAxis type="category" dataKey="name" tick={axisTick} width={160} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => Number(v).toFixed(2)} />
              <Bar dataKey="net">
                {data.factors.map((f) => (
                  <Cell key={f.slug} fill={f.net >= 0 ? chartColors.gain : chartColors.loss} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Holdings by factor (signed exposure, -3 to +3)</CardTitle>
        </CardHeader>
        <CardContent
          className="overflow-x-auto"
          role="region"
          aria-label="Holdings by factor, scrollable"
          tabIndex={0}
        >
          <table
            className="border-separate border-spacing-1 text-sm"
            aria-label="Holdings by factor"
          >
            <thead>
              <tr>
                <th />
                {factorSlugs.map((slug) => (
                  <th key={slug} scope="col" className="px-2 text-left font-medium">
                    {data.factors.find((f) => f.slug === slug)!.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickers.map((t) => (
                <tr key={t}>
                  <th scope="row" className="pr-2 text-right font-medium">
                    {t}
                  </th>
                  {factorSlugs.map((slug) => {
                    const x = cell(t, slug);
                    return (
                      <td
                        key={slug}
                        className="min-w-12 rounded px-2 py-2 text-center tabular-nums"
                        style={x ? cellStyle(x.signed) : undefined}
                        title={
                          x
                            ? `${t} / ${slug}: ${x.signed > 0 ? "+" : ""}${x.signed} (confidence ${pct(x.confidence, 0)})${x.rationale ? ` - ${x.rationale}` : ""}${x.evidence ? ` Annual report: "${x.evidence}"` : ""}`
                            : undefined
                        }
                      >
                        {x ? `${x.signed > 0 ? "+" : ""}${x.signed}` : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <ScoreMethodCard cells={data.cells} />
      <EvidenceTable cells={data.cells} nameOf={nameOf} />
      <PriceCheckCard id={id} nameOf={nameOf} />

      <Card>
        <CardHeader>
          <CardTitle>Shared risks between holdings</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-normal">Pair</TableHead>
                <TableHead className="text-right whitespace-normal">Similarity</TableHead>
                <TableHead className="whitespace-normal">Shared exposure</TableHead>
                <TableHead className="whitespace-normal">Offsetting</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.pairs.map((p) => (
                <TableRow key={`${p.a}-${p.b}`}>
                  <TableCell className="font-medium whitespace-normal">
                    {p.a} / {p.b}
                  </TableCell>
                  <TableCell className="text-right whitespace-normal tabular-nums">
                    {p.similarity === null ? "n/a" : p.similarity.toFixed(2)}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {p.shared.map(nameOf).join(", ") || "none"}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {p.offsetting.map(nameOf).join(", ") || "none"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
