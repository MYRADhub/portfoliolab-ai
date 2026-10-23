"use client";

import { useState } from "react";
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
import { signedPct } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { Spillover } from "@/server/spillover";

const r2 = (x: number | null) => (x === null ? "n/a" : `${x >= 0 ? "+" : ""}${x.toFixed(2)}`);

/** Tests the product's central claim on real events: do stocks with similar hidden exposures move together? */
export function SpilloverCard() {
  const { data: list } = useApi<{ eligible: string[] }>("/api/events/spillover");
  const [picked, setPicked] = useState<string | null>(null);
  const ticker = picked ?? list?.eligible[0] ?? null;
  const { data, error } = useApi<Spillover>(
    ticker ? `/api/events/spillover?ticker=${ticker}` : "/api/health",
  );
  const result = data && "events" in data ? data : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Do stocks with similar hidden exposures move together?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <HowToRead title="How this test works">
          <p>
            When a large company reports earnings, its stock jumps or falls. This test asks whether
            other stocks whose hidden exposures resemble that company&apos;s moved the same way that
            day, more than stocks with different exposures did.
          </p>
          <p>
            For each earnings day we line up every other stock&apos;s abnormal return (the part not
            explained by the market, flipped so that moving the same way as the company counts as
            positive) against how similar its exposures are, and take the correlation. The
            sector-adjusted figure removes whatever &ldquo;is in the same sector&rdquo; explains, so
            it shows whether exposures add something the sector label does not.
          </p>
          <p>
            Small positive numbers are what to expect: one company&apos;s news is a faint signal for
            another. Events on the same day are not fully independent, and the exposure scores are
            AI drafts, so treat this as evidence, not proof.
          </p>
        </HowToRead>

        {!list ? (
          <Loading />
        ) : list.eligible.length === 0 ? (
          <p className="text-muted-foreground">
            No large company has enough earnings history to run this test yet.
          </p>
        ) : (
          <>
            <label className="flex items-center gap-2">
              Company reporting earnings
              <select
                aria-label="Company reporting earnings"
                value={ticker ?? ""}
                onChange={(e) => setPicked(e.target.value)}
                className="rounded-md border bg-background px-2 py-1"
              >
                {list.eligible.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            {!result && !error && <Loading />}
            {result && <Result r={result} />}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Result({ r }: { r: Spillover }) {
  const s = r.summary;
  const p = r.partialSummary;
  const verdict =
    p === null || p.t === null
      ? "Not enough comparable stocks on these days to say."
      : p.t >= 2
        ? "Stocks with similar exposures tended to move with it, even after accounting for sector."
        : p.t <= -2
          ? "Stocks with similar exposures tended to move against it."
          : "No reliable pattern beyond the sector label.";
  return (
    <div className="space-y-4" role="region" aria-label="Spillover result">
      <p data-testid="spillover-verdict" className="font-medium">
        {r.name}: {verdict}
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Events studied", String(r.events.length)],
          ["Average correlation", s ? r2(s.mean) : "n/a"],
          ["Sector-adjusted", p ? r2(p.mean) : "n/a"],
          [
            "Similar minus different",
            r.similarMean !== null && r.dissimilarMean !== null
              ? signedPct(r.similarMean - r.dissimilarMean, 2)
              : "n/a",
          ],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="text-lg font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {p && p.t !== null && (
        <p className="text-xs text-muted-foreground">
          Sector-adjusted: t = {p.t.toFixed(2)}, 95% range {r2(p.ci[0])} to {r2(p.ci[1])} over {p.n}{" "}
          events.
        </p>
      )}
      <Table aria-label="Earnings days">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Earnings day</TableHead>
            <TableHead scope="col" className="text-right">
              Company move
            </TableHead>
            <TableHead scope="col" className="text-right">
              Stocks compared
            </TableHead>
            <TableHead scope="col" className="text-right">
              Correlation
            </TableHead>
            <TableHead scope="col" className="text-right">
              Sector-adjusted
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {r.events.map((e) => (
            <TableRow key={e.date}>
              <TableCell>{e.date}</TableCell>
              <TableCell className="text-right tabular-nums">{signedPct(e.ar0, 2)}</TableCell>
              <TableCell className="text-right tabular-nums">{e.stocks}</TableCell>
              <TableCell className="text-right tabular-nums">{r2(e.correlation)}</TableCell>
              <TableCell className="text-right tabular-nums">{r2(e.partialCorrelation)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
