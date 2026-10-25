"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HowToRead } from "@/components/ui/how-to-read";
import { Loading } from "@/components/ui/skeleton";
import { signedPct } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { PooledReport } from "@/server/spillover";

const r3 = (x: number | null | undefined) =>
  x === null || x === undefined ? "n/a" : `${x >= 0 ? "+" : ""}${x.toFixed(3)}`;
const p3 = (x: number | null) => (x === null ? "n/a" : x < 0.001 ? "< 0.001" : x.toFixed(3));

/** Pools every large company's earnings days into one test, with honest uncertainty and a shuffled-scores placebo. */
export function PooledSpilloverCard() {
  const { data, error } = useApi<PooledReport>("/api/events/spillover?pooled=1");

  return (
    <Card>
      <CardHeader>
        <CardTitle>All large companies pooled</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <HowToRead title="How the pooled test works">
          <p>
            One company&apos;s earnings days are a small sample. Here every earnings day of every
            large company is combined into a single test of the same question: whether stocks with
            similar hidden exposures move together.
          </p>
          <p>
            Two checks keep it honest. Earnings days in the same calendar week share the
            market&apos;s mood, so they are averaged into one observation before the uncertainty is
            worked out. And a <strong>placebo</strong> reshuffles which stock gets which similarity
            score inside every event, 200 times: if the real result is no bigger than shuffled ones,
            it is chance. The placebo p-value is the share of shuffled runs that did at least as
            well.
          </p>
          <p>
            It tests whether the exposure scores carry information about real moves. It does not say
            a portfolio built on them would make money, and the scores are AI drafts.
          </p>
        </HowToRead>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {!data && !error && <Loading />}
        {data && <Result r={data} />}
      </CardContent>
    </Card>
  );
}

function Result({ r }: { r: PooledReport }) {
  const c = r.clusteredPartial;
  if (r.events === 0 || !c)
    return (
      <p className="text-muted-foreground" data-testid="pooled-verdict">
        Not enough earnings days with enough comparable stocks to pool yet.
      </p>
    );
  const placeboOk = r.placebo.pPartial !== null && r.placebo.pPartial < 0.05;
  const clusteredOk = c.t !== null && c.t >= 2;
  const verdict =
    clusteredOk && placeboOk
      ? "Pooled across companies, stocks with similar exposures moved together beyond sector, and shuffled scores do not reproduce it."
      : c.t !== null && c.t <= -2
        ? "Pooled across companies, similar stocks tended to move against the event company."
        : "Pooled across companies, no reliable relationship survives the stricter checks.";
  return (
    <div className="space-y-4" role="region" aria-label="Pooled spillover result">
      <p data-testid="pooled-verdict" className="font-medium">
        {verdict}
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Earnings days", `${r.events} (${r.companies.length} companies)`],
          ["Independent weeks", String(r.clusters)],
          ["Sector-adjusted correlation", r3(r.partialCorrelation?.mean)],
          [
            "Similar minus different",
            r.similarMinusDissimilar === null ? "n/a" : signedPct(r.similarMinusDissimilar, 2),
          ],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="text-lg font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <ul className="space-y-1 text-xs text-muted-foreground" aria-label="Pooled statistics">
        <li>
          Treating every earnings day as independent: t ={" "}
          {r.partialCorrelation?.t?.toFixed(2) ?? "n/a"}.
        </li>
        <li>
          Counting each week once: t = {c.t?.toFixed(2) ?? "n/a"}, 95% range {r3(c.ci[0])} to{" "}
          {r3(c.ci[1])} over {c.n} weeks.
        </li>
        <li>
          Placebo with shuffled scores ({r.placebo.permutations} runs): they average{" "}
          {r3(r.placebo.nullMean)} (spread {r.placebo.nullSd?.toFixed(3) ?? "n/a"}); the chance that
          shuffled scores match the real raw correlation is p = {p3(r.placebo.pCorrelation)}, and
          the sector-adjusted one p = {p3(r.placebo.pPartial)}.
        </li>
        <li>Companies pooled: {r.companies.join(", ")}.</li>
      </ul>
    </div>
  );
}
