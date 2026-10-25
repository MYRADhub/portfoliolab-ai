"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

/** The product's central claims, tested on the loaded data, each with a verdict, the figures and the limits. */
export function EvidenceView() {
  const { data, error } = useApi<Evidence>("/api/evidence");
  return (
    <div className="space-y-6">
      <HowToRead>
        <p>
          A tool that shows you hidden risks should show you how it knows they are real. This page
          runs three tests on the data loaded right now and states the result in words, with the
          numbers behind it and what each test cannot show.
        </p>
        <p>
          &ldquo;Supported&rdquo; means the test cleared a stated bar, not that the idea is proven.
          Nothing here is written in advance: change the data and the verdicts can change.
        </p>
      </HowToRead>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!data && !error && <Loading rows={3} />}
      {data && (
        <ul className="space-y-6" aria-label="Findings">
          {data.findings.map((f) => (
            <li key={f.id}>
              <Card>
                <CardHeader>
                  <CardTitle>{f.question}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <span
                      data-testid={`verdict-${f.id}`}
                      className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${TONE[f.verdict]}`}
                    >
                      {LABEL[f.verdict]}
                    </span>
                    <span className="font-medium">{f.result}</span>
                  </p>
                  {f.figures.length > 0 && (
                    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                      {f.figures.map((x) => (
                        <div key={x.label} className="rounded-lg border p-3">
                          <dt className="text-xs text-muted-foreground">{x.label}</dt>
                          <dd className="text-base font-semibold tabular-nums">{x.value}</dd>
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
                  <Link href={f.href} className="text-xs underline underline-offset-2">
                    See the full test
                  </Link>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
