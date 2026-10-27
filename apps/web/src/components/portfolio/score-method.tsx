"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loading } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { pct } from "@/lib/format";
import { exposureProvenance } from "@/lib/provenance";
import { useApi } from "@/lib/use-api";
import type { ExposureCell } from "@/server/exposures";
import type { PortfolioPriceCheck } from "@/server/price-check";

const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;

/** How each exposure score was produced, with counts for the scores on this page. */
export function ScoreMethodCard({ cells }: { cells: ExposureCell[] }) {
  const grounded = cells.filter((c) => c.evidence).length;
  const reviewed = cells.filter((c) => exposureProvenance(c.rationale) === "reviewed").length;
  const other = cells.length - grounded - reviewed;
  return (
    <Card data-testid="score-method">
      <CardHeader>
        <CardTitle>How the scores are made</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          Each company gets a score from -3 to +3 for each force: the size (1 minor, 2 meaningful, 3
          central to its value) times the direction (+ if the company tends to gain when the force
          rises, - if it tends to lose).
        </p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            <span className="font-medium">From the company&apos;s own annual report.</span> The
            business description and risk factors are taken from its last Form 10-K filed with the
            SEC before the period the app tests, so the report cannot describe that period after the
            fact.
          </li>
          <li>
            <span className="font-medium">Every score quotes the report.</span> An AI model reads
            the excerpts and must back each score with a passage copied from them. The passage is
            then searched for in the report, ignoring only case and punctuation; a score whose
            passage is not there is thrown away.
          </li>
          <li>
            <span className="font-medium">Five independent runs, middle answer kept.</span> The
            model scores each company five times. For each force the stored score is the median of
            the five, counting a run that left the force out as 0, so a force must come up in most
            runs to survive. Stability is the share of runs that gave exactly that score, and the
            confidence (0.3 to 0.8) rises with it.
          </li>
          <li>
            <span className="font-medium">Checked against prices.</span> Separately, each
            company&apos;s actual sensitivity to a market signal for each force is measured from
            earlier prices (below). That check is never fed back into the scores.
          </li>
        </ol>
        <p data-testid="score-method-counts">
          On this page: {grounded} of {cells.length} scores are grounded in an annual report
          {reviewed > 0 && `, ${reviewed} were set by a person`}
          {other > 0 && `, ${other} are older AI drafts from the model's general knowledge`}.
        </p>
        <p className="text-xs text-muted-foreground">
          Limits: no person has reviewed these scores yet; the model may still lean on what it
          remembers about a company despite the instructions; a report can stress some risks for
          legal reasons more than they matter economically; and the scale is a judgement, not a
          measured quantity.
        </p>
      </CardContent>
    </Card>
  );
}

/** Every score on the page with the passage behind it, folded away by default. */
export function EvidenceTable({
  cells,
  nameOf,
}: {
  cells: ExposureCell[];
  nameOf: (slug: string) => string;
}) {
  const rows = [...cells].sort(
    (a, b) => a.ticker.localeCompare(b.ticker) || Math.abs(b.signed) - Math.abs(a.signed),
  );
  return (
    <details className="rounded-lg border px-4 py-2.5 text-sm" data-testid="score-evidence">
      <summary className="cursor-pointer font-medium select-none">
        The passage behind each score ({rows.length})
      </summary>
      <div className="mt-3 overflow-x-auto">
        <Table aria-label="Evidence for each exposure score">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Holding</TableHead>
              <TableHead scope="col">Force</TableHead>
              <TableHead scope="col" className="text-right">
                Score
              </TableHead>
              <TableHead scope="col" className="text-right">
                Runs agreeing
              </TableHead>
              <TableHead scope="col">From the annual report</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={`${c.ticker}-${c.factor}`}>
                <TableCell className="font-medium">{c.ticker}</TableCell>
                <TableCell className="whitespace-normal">{nameOf(c.factor)}</TableCell>
                <TableCell className="text-right tabular-nums">{signed(c.signed)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.stability === null ? "n/a" : pct(c.stability, 0)}
                </TableCell>
                <TableCell className="max-w-xl whitespace-normal">
                  {c.evidence ? (
                    <>
                      &ldquo;{c.evidence}&rdquo;{" "}
                      {c.source && (
                        <a
                          href={c.source}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs underline underline-offset-2"
                        >
                          10-K
                        </a>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      No passage:{" "}
                      {exposureProvenance(c.rationale) === "reviewed"
                        ? "set by a person"
                        : "older draft"}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </details>
  );
}

const VERDICT_LABEL = {
  agrees: "Prices agree",
  disagrees: "Prices disagree",
  unclear: "Not clear from prices",
} as const;

/** The scores set against measured sensitivities to market signals, across the index and for these holdings. */
export function PriceCheckCard({ id, nameOf }: { id: string; nameOf: (slug: string) => string }) {
  const { data, error } = useApi<PortfolioPriceCheck>(`/api/portfolios/${id}/price-check`);
  return (
    <Card data-testid="price-check">
      <CardHeader>
        <CardTitle>Checked against prices</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {!data && !error && <Loading rows={3} />}
        {data && !data.available && (
          <p>Prices for the market signals are not loaded, so the scores cannot be checked yet.</p>
        )}
        {data?.available && (
          <>
            <p>
              Each force is matched to a traded fund that tends to rise with it. For every company,
              its daily returns from {data.window.from} to {data.window.to} ({data.window.days}{" "}
              days, before the period the app tests) are regressed on the market and on the part of
              the fund&apos;s return the market does not explain. The result is the company&apos;s
              measured sensitivity to the force, as a t-statistic: beyond 2 in either direction it
              is reliable.
            </p>
            <div className="overflow-x-auto">
              <Table aria-label="Scores against measured sensitivities, by force">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Force</TableHead>
                    <TableHead scope="col">Market signal</TableHead>
                    <TableHead scope="col" className="text-right">
                      Rank correlation
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      Direction agrees
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.forces.map((f) => (
                    <TableRow key={f.slug}>
                      <TableCell className="font-medium whitespace-normal">{f.name}</TableCell>
                      <TableCell className="whitespace-normal text-muted-foreground">
                        {f.proxy ?? "No clean market signal; not checked"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {f.spearman === null ? "n/a" : f.spearman.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {f.signAgreement === null
                          ? "n/a"
                          : `${pct(f.signAgreement, 0)} of ${f.reliable}`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              Rank correlation: across all{" "}
              {data.forces.find((f) => f.companies > 0)?.companies ?? 0} measured companies, how
              closely the order of the scores follows the order of the measured sensitivities (1 is
              perfect, 0 is none). Direction agrees: among companies with a score and a reliable
              measurement, the share where both point the same way. A fund is only a rough stand-in
              for a force, some funds hold the very stocks being measured, and a staples company can
              score positively on consumer spending yet move against a discretionary-minus-staples
              signal, so low agreement can be the signal&apos;s fault as much as the score&apos;s.
            </p>
            {data.holdings.length > 0 && (
              <div className="overflow-x-auto">
                <Table aria-label="Your holdings: scores against measured sensitivities">
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Holding</TableHead>
                      <TableHead scope="col">Force</TableHead>
                      <TableHead scope="col" className="text-right">
                        Score
                      </TableHead>
                      <TableHead scope="col" className="text-right">
                        Measured (t)
                      </TableHead>
                      <TableHead scope="col">Verdict</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.holdings.map((h) => (
                      <TableRow key={`${h.ticker}-${h.slug}`}>
                        <TableCell className="font-medium">{h.ticker}</TableCell>
                        <TableCell className="whitespace-normal">{nameOf(h.slug)}</TableCell>
                        <TableCell className="text-right tabular-nums">{signed(h.score)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {h.t === null ? "n/a" : h.t.toFixed(1)}
                        </TableCell>
                        <TableCell
                          className={
                            h.verdict === "disagrees"
                              ? "font-medium text-loss"
                              : h.verdict === "agrees"
                                ? "text-gain"
                                : "text-muted-foreground"
                          }
                        >
                          {VERDICT_LABEL[h.verdict]}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
