"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { HowToRead } from "@/components/ui/how-to-read";
import { Loading } from "@/components/ui/skeleton";
import { useApi } from "@/lib/use-api";
import type { Evidence, Verdict } from "@/server/evidence";

const LABEL: Record<Verdict, string> = {
  supported: "Supported",
  not_supported: "Not supported",
  inconclusive: "Inconclusive",
  no_data: "Not enough data",
};

const TONE: Record<Verdict, string> = {
  supported: "border-gain text-gain",
  not_supported: "border-loss text-loss",
  inconclusive: "border-border text-foreground",
  no_data: "border-border text-muted-foreground",
};

/** Why each test matters to the app, in one plain sentence. */
const WHY: Record<Evidence["findings"][number]["id"], string> = {
  spillover:
    "If it holds, the forces really tie companies together across sectors, so the exposure map shows real links.",
  sectors:
    "If it holds, the exposure scores say more about how stocks move than the sector labels most tools show.",
  earnings:
    "A check on the data itself: if earnings days did not stand out, the price and event data would be suspect.",
  drafts:
    "If it holds, the AI-drafted scores agree with a careful person about as well as two people agree with each other.",
};

const DOT: Record<Verdict, string> = {
  supported: "bg-gain",
  not_supported: "bg-loss",
  inconclusive: "bg-foreground",
  no_data: "bg-muted-foreground",
};

/** The product's central claims, tested on the loaded data: a verdict line for each, with the details folded away. */
export function EvidenceView() {
  const { data, error } = useApi<Evidence>("/api/evidence");
  const counts = data
    ? (Object.keys(LABEL) as Verdict[])
        .map((v) => [v, data.findings.filter((f) => f.verdict === v).length] as const)
        .filter(([, n]) => n > 0)
    : [];
  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!data && !error && <Loading rows={3} />}
      {data && (
        <>
          <p className="max-w-3xl text-sm" data-testid="evidence-summary">
            PortfolioLab rests on {data.findings.length} claims. Each one is tested on the data
            loaded right now:{" "}
            {counts.map(([v, n], i) => (
              <span key={v}>
                {i > 0 && (i === counts.length - 1 ? " and " : ", ")}
                <strong>
                  {n} {LABEL[v].toLowerCase()}
                </strong>
              </span>
            ))}
            . Open a claim for its numbers and what the test cannot show.
          </p>
          <ul className="space-y-2" aria-label="Findings">
            {data.findings.map((f, i) => (
              <li key={f.id} data-tour={i === 0 ? "evidence-finding" : undefined}>
                <Card className="gap-0 py-0">
                  <CardContent className="space-y-1.5 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span
                        data-testid={`verdict-${f.id}`}
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${TONE[f.verdict]}`}
                      >
                        <span
                          aria-hidden="true"
                          className={`size-1.5 rounded-full ${DOT[f.verdict]}`}
                        />
                        {LABEL[f.verdict]}
                      </span>
                      <h2 className="text-base font-semibold">{f.question}</h2>
                    </div>
                    <p className="text-sm">{f.result}</p>
                    <p className="text-xs text-muted-foreground">{WHY[f.id]}</p>
                    <details className="group text-sm">
                      <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium select-none">
                        <span className="underline underline-offset-2">
                          The numbers and the limits
                        </span>
                      </summary>
                      <div className="mt-2 space-y-3">
                        {f.figures.length > 0 && (
                          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                            {f.figures.map((x) => (
                              <div key={x.label} className="rounded-lg border px-3 py-2">
                                <dt className="text-xs text-muted-foreground">{x.label}</dt>
                                <dd className="font-semibold tabular-nums">{x.value}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        {f.caveats.length > 0 && (
                          <div>
                            <h3 className="text-xs font-medium">What this does not show</h3>
                            <ul className="list-disc pl-5 text-xs text-muted-foreground">
                              {f.caveats.map((c) => (
                                <li key={c}>{c}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </details>
                    {f.href.startsWith("/api/") ? (
                      <a href={f.href} download className="text-xs underline underline-offset-2">
                        {f.linkLabel ?? "See the full test"}
                      </a>
                    ) : (
                      <Link href={f.href} className="text-xs underline underline-offset-2">
                        {f.linkLabel ?? "See the full test"}
                      </Link>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          <HowToRead title="How the verdicts are decided">
            <p>
              Each claim has a bar written down in advance and implemented as a tested function.
              &ldquo;Supported&rdquo; means the test cleared its bar on the data loaded now, not
              that the idea is proven. &ldquo;Not enough data&rdquo; means the test could not run,
              for example because too few companies have been scored by a person.
            </p>
            <p>
              Nothing on this page is typed in by hand: change the data and the verdicts can change.
            </p>
          </HowToRead>
        </>
      )}
    </div>
  );
}
