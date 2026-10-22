"use client";

import { ClassBadge } from "@/components/news/class-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { pct, signedPct } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { EventStudyReport } from "@/server/events";

const SKIP_LABEL: Record<string, string> = {
  not_classified: "not yet classified",
  no_event_day: "no price on the event day",
  short_history: "less than about 3 months of earlier prices",
  flat_market: "no usable market movement",
};

const tone = (x: number) => (x > 0 ? "text-gain" : x < 0 ? "text-loss" : "");

export function EventsView() {
  const { data, error } = useApi<EventStudyReport>("/api/events");
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!data) return <p className="text-muted-foreground">Loading</p>;

  const skipped = Object.entries(data.skipped);
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted-foreground">
        For each classified story, this compares what a stock actually did around the news with what
        it would normally do given how the market moved. The difference is the abnormal return. It
        separates the market&apos;s general direction from the stock&apos;s own reaction.
      </p>

      <p className="text-sm" data-testid="events-summary">
        {data.eventsStudied} of {data.eventsFound} story-stock pairs studied, using {data.universe}{" "}
        stocks as the market proxy ({data.window.from} to {data.window.to}).
        {skipped.length > 0 &&
          ` Skipped: ${skipped.map(([k, n]) => `${n} ${SKIP_LABEL[k] ?? k}`).join("; ")}.`}
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Average reaction by type of news</CardTitle>
        </CardHeader>
        <CardContent>
          {data.byType.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No classified stories have enough price history around them yet.
            </p>
          ) : (
            <Table aria-label="Average reaction by event type">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Type</TableHead>
                  <TableHead scope="col" className="text-right">
                    Events
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Typical move (either way)
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Average over the first 2 days
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    95% range
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    t
                  </TableHead>
                  <TableHead scope="col">Read as</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byType.map((t) => {
                  const h = t.horizons.find((x) => x.horizon === 1) ?? t.horizons[0];
                  if (!h) return null;
                  const s = h.stats;
                  return (
                    <TableRow key={t.slug}>
                      <TableCell className="font-medium">
                        {t.name}
                        {t.excludedOverlap > 0 && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {t.excludedOverlap} left out: within a week of earnings news
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{t.n}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.typicalMove === null ? "n/a" : pct(t.typicalMove, 1)}
                        {t.unusualShare !== null && (
                          <span className="block text-xs text-muted-foreground">
                            {pct(t.unusualShare, 0)} unusual
                          </span>
                        )}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${tone(s.mean)}`}>
                        {signedPct(s.mean, 2)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {signedPct(s.ci[0], 2)} to {signedPct(s.ci[1], 2)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.t === null ? "n/a" : s.t.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {!s.sufficient
                          ? "Too few events to judge"
                          : s.t !== null && Math.abs(s.t) >= 2
                            ? "Distinguishable from zero"
                            : "Not distinguishable from zero"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Biggest reactions</CardTitle>
        </CardHeader>
        <CardContent>
          {data.reactions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to show yet.</p>
          ) : (
            <ul aria-label="Reactions" className="space-y-2">
              {data.reactions.map((r) => (
                <li
                  key={`${r.url}-${r.ticker}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3 text-sm"
                >
                  <span className="w-14 font-semibold">{r.ticker}</span>
                  <span className={`w-20 text-right font-semibold tabular-nums ${tone(r.ar0)}`}>
                    {signedPct(r.ar0, 2)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">
                      {r.title}
                    </a>
                    <span className="block text-xs text-muted-foreground">
                      {r.eventDate}
                      {r.eventType ? ` | ${r.eventType.replaceAll("_", " ")}` : ""}
                      {r.z0 !== null && ` | ${r.z0.toFixed(1)} times its normal daily noise`}
                    </span>
                  </span>
                  <ClassBadge value={r.class} />
                  {r.overlapsEarnings && (
                    <span className="rounded border px-1.5 py-0.5 text-xs">Near earnings news</span>
                  )}
                  {r.z0 !== null && Math.abs(r.z0) >= 2 && (
                    <span className="rounded border px-1.5 py-0.5 text-xs font-medium">
                      Unusual move
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="max-w-3xl text-xs text-muted-foreground">
        Method: market model fitted on the 250 to 30 trading days before each event, with the
        average of the other stocks in our universe as the market. Several stories on the same day,
        overlapping earnings and a small universe all blur the result, and a handful of events says
        little. This is research information, not a prediction or advice.
      </p>
    </div>
  );
}
