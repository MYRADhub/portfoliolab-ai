"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { ExplainResult } from "@/server/explain";

/** Renders [F3] style citations as small superscript markers; the full facts are listed below the text. */
function withCitations(text: string): React.ReactNode[] {
  return text.split(/(\[\s*F\d+(?:\s*,\s*F\d+)*\s*\])/g).map((part, i) =>
    /^\[\s*F/.test(part) ? (
      <sup key={i} className="ml-0.5 text-xs text-muted-foreground">
        {part.replace(/[[\]\s]/g, "")}
      </sup>
    ) : (
      part
    ),
  );
}

export function ExplainPanel({ portfolioId }: { portfolioId: string }) {
  const [state, setState] = useState<{
    id: string;
    result?: ExplainResult;
    error?: string;
    busy?: boolean;
  } | null>(null);
  const current = state?.id === portfolioId ? state : null;

  async function run() {
    setState({ id: portfolioId, busy: true });
    try {
      const result = await api<ExplainResult>(`/api/portfolios/${portfolioId}/explain`, {
        method: "POST",
      });
      setState({ id: portfolioId, result });
    } catch (e) {
      setState({ id: portfolioId, error: e instanceof Error ? e.message : "Something went wrong" });
    }
  }

  const r = current?.result;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Explain this portfolio</CardTitle>
        <Button size="sm" onClick={() => void run()} disabled={current?.busy}>
          {current?.busy ? "Working" : r ? "Refresh" : "Explain"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {current?.error && (
          <p role="alert" className="text-destructive">
            {current.error}
          </p>
        )}
        {!r && !current?.error && (
          <p className="text-muted-foreground">
            A plain-English reading of the numbers on this page.
          </p>
        )}
        {r && (
          <>
            {r.explanation.source === "fallback" && (
              <p className="text-muted-foreground">
                The written explanation could not be verified against the numbers, so only the
                figures are shown.
              </p>
            )}
            <p>{withCitations(r.explanation.summary)}</p>
            {r.explanation.highlights.length > 0 && (
              <ul className="list-disc space-y-1 pl-5">
                {r.explanation.highlights.map((h, i) => (
                  <li key={i}>{withCitations(h)}</li>
                ))}
              </ul>
            )}
            <details>
              <summary className="cursor-pointer text-muted-foreground">Figures used</summary>
              <ul className="mt-2 space-y-0.5">
                {r.facts.map((f) => (
                  <li key={f.id}>
                    <span className="text-muted-foreground">{f.id}</span> {f.label}: {f.text}
                  </li>
                ))}
              </ul>
            </details>
            <p className="text-xs text-muted-foreground">{r.disclaimer}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
