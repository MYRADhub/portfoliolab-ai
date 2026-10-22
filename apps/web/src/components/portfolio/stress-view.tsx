"use client";

import { useEffect, useState } from "react";
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
import { pct, signedPct } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { StressCatalog, StressOutcome } from "@/server/stress";
import { ExplainTool } from "./explain-tool";
import { WithPortfolio } from "./with-portfolio";
import { HowToRead } from "@/components/ui/how-to-read";
import { Loading } from "@/components/ui/skeleton";

export function StressView() {
  return <WithPortfolio>{(id) => <Content key={id} id={id} />}</WithPortfolio>;
}

function Content({ id }: { id: string }) {
  const { data: catalog, error } = useApi<StressCatalog>(`/api/portfolios/${id}/stress`);
  const [preset, setPreset] = useState<string | null>(null);
  const [custom, setCustom] = useState<Record<string, number>>({});
  const [result, setResult] = useState<StressOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const body = preset ? { preset } : { shocks: custom };
  const active = preset !== null || Object.values(custom).some((v) => v !== 0);
  const bodyKey = JSON.stringify(body);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api<StressOutcome>(`/api/portfolios/${id}/stress`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: bodyKey,
      })
        .then((r) => {
          if (cancelled) return;
          setResult(r);
          setFailure(null);
        })
        .catch((e) => !cancelled && setFailure(e instanceof Error ? e.message : "Failed"));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, active, bodyKey]);

  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!catalog) return <Loading />;
  if (!catalog.available)
    return (
      <Card>
        <CardContent>
          <p>
            Stress tests need exposure profiles for every holding. Load exposure data or choose a
            portfolio whose holdings are covered.
          </p>
        </CardContent>
      </Card>
    );

  const shown = active ? result : null;

  return (
    <div className="space-y-6">
      <HowToRead>
        <p>
          A stress test asks &ldquo;what if this happened?&rdquo; Pick a scenario, such as interest
          rates jumping, or drag the sliders to push individual economic forces up or down. Each
          holding is hit in proportion to how exposed it is to those forces.
        </p>
        <p>
          The <strong>vulnerability score</strong> runs from 0 to 10 (10 means a loss of 10% or
          more). The <strong>reliability</strong> figure shows how confident the underlying exposure
          estimates are. The result is an illustrative estimate built on a simple rule, not a
          forecast.
        </p>
      </HowToRead>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Pick a scenario or move the sliders to see how this portfolio might react. This is an
        illustrative what-if built from each holding&apos;s hidden exposures, not a forecast.
      </p>

      {catalog.presets.length > 0 && (
        <div role="group" aria-label="Scenarios" className="flex flex-wrap gap-2">
          {catalog.presets.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={preset === p.id}
              title={p.description}
              onClick={() => setPreset(preset === p.id ? null : p.id)}
              className={`rounded-md border px-3 py-1.5 text-sm ${preset === p.id ? "bg-muted font-medium" : ""}`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      <Card data-tour="stress-controls">
        <CardHeader>
          <CardTitle>Custom scenario</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {catalog.factors.map((f) => {
            const v = preset ? 0 : (custom[f.slug] ?? 0);
            return (
              <label key={f.slug} className="flex flex-col gap-1 text-sm">
                <span className="flex justify-between">
                  <span>{f.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {v === 0
                      ? "no change"
                      : `${v > 0 ? "up" : "down"} ${Math.abs(Math.round(v * 100))}%`}
                  </span>
                </span>
                <input
                  type="range"
                  className="accent-primary"
                  min={-1}
                  max={1}
                  step={0.1}
                  value={v}
                  aria-label={f.name}
                  onChange={(e) => {
                    setPreset(null);
                    setCustom({ ...custom, [f.slug]: Number(e.target.value) });
                  }}
                />
              </label>
            );
          })}
        </CardContent>
      </Card>

      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}

      {!active && (
        <p className="text-muted-foreground">Choose a scenario or move a slider to begin.</p>
      )}

      {shown && shown.available && <Result r={shown} />}
      {shown && shown.available && shown.touched && (
        <ExplainTool portfolioId={id} tool="stress" params={body} label="Explain this scenario" />
      )}
    </div>
  );
}

function Result({ r }: { r: Extract<StressOutcome, { available: true }> }) {
  return (
    <div className="space-y-4" aria-label="Stress result" role="region">
      {!r.touched ? (
        <Card>
          <CardContent>
            <p>
              None of your holdings are exposed to the forces in this scenario, so it has no
              estimated effect.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Estimated portfolio impact</CardTitle>
              </CardHeader>
              <CardContent>
                <p
                  data-testid="stress-impact"
                  className={`text-3xl font-semibold tabular-nums ${r.portfolioImpact < 0 ? "text-loss" : "text-gain"}`}
                >
                  {signedPct(r.portfolioImpact, 2)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Vulnerability</CardTitle>
              </CardHeader>
              <CardContent>
                <p
                  data-testid="stress-vulnerability"
                  className="text-3xl font-semibold tabular-nums"
                >
                  {r.vulnerability.toFixed(1)}
                  <span className="text-base font-normal text-muted-foreground"> / 10</span>
                </p>
                <p className="text-xs text-muted-foreground">10 means a loss of 10% or more.</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Reliability of inputs</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold tabular-nums">
                  {r.reliability === null ? "n/a" : pct(r.reliability, 0)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Confidence in the exposures behind this.
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>What drives it</CardTitle>
            </CardHeader>
            <CardContent>
              <Table aria-label="Impact by force">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Force</TableHead>
                    <TableHead scope="col" className="text-right">
                      Portfolio effect
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.factors.map((f) => (
                    <TableRow key={f.slug}>
                      <TableCell>{f.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {signedPct(f.contribution, 2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>By holding, hardest hit first</CardTitle>
            </CardHeader>
            <CardContent>
              <Table aria-label="Impact by holding">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Holding</TableHead>
                    <TableHead scope="col" className="text-right">
                      Weight
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      Estimated move
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      Portfolio effect
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.holdings.map((h) => (
                    <TableRow key={h.ticker}>
                      <TableCell className="font-medium">{h.ticker}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(h.weight, 0)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {signedPct(h.impact, 1)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {signedPct(h.contribution, 2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Each exposure point is assumed to move a stock by {pct(r.percentPerPoint, 0)} under a
        full-size shock. That figure is an assumption, factors are treated independently, and
        nothing here is a prediction or advice.
      </p>
    </div>
  );
}
