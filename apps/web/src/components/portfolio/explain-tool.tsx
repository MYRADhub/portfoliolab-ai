"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { ExplainResult } from "@/server/explain";
import { ExplanationBody } from "./explain-panel";

/** A button that asks for a plain-English reading of the tool's current result, checked against its own numbers. */
export function ExplainTool({
  portfolioId,
  tool,
  params,
  label = "Explain this result",
}: {
  portfolioId: string;
  tool: "stress" | "rebalance" | "simulation";
  params: object;
  label?: string;
}) {
  const key = JSON.stringify({ portfolioId, tool, params });
  const [state, setState] = useState<{
    key: string;
    result?: ExplainResult;
    error?: string;
    busy?: boolean;
  } | null>(null);
  const current = state?.key === key ? state : null;

  async function run() {
    setState({ key, busy: true });
    try {
      const result = await api<ExplainResult>(`/api/portfolios/${portfolioId}/explain-tool`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool, ...params }),
      });
      setState({ key, result });
    } catch (e) {
      setState({ key, error: e instanceof Error ? e.message : "Something went wrong" });
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>In plain English</CardTitle>
        <Button size="sm" onClick={() => void run()} disabled={current?.busy}>
          <Sparkles aria-hidden="true" />
          {current?.busy ? "Working" : current?.result ? "Refresh" : label}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {current?.error && (
          <p role="alert" className="text-destructive">
            {current.error}
          </p>
        )}
        {!current?.result && !current?.error && (
          <p className="text-muted-foreground">
            A short explanation written from the numbers above, with every figure cited.
          </p>
        )}
        {current?.result && <ExplanationBody result={current.result} />}
      </CardContent>
    </Card>
  );
}
