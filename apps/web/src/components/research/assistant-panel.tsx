"use client";

import { useState } from "react";
import { withCitations } from "@/components/portfolio/explain-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { AssistantResult } from "@/server/assistant";

const SUGGESTIONS = [
  "What is the biggest risk in my portfolio?",
  "Is my portfolio really diversified?",
  "Which recent news matters most to me?",
  "What happens to my portfolio if rates jump?",
];

const TOOL_LABEL: Record<string, string> = {
  get_portfolio_summary: "Portfolio summary",
  get_exposures: "Hidden exposures",
  get_company: "Company data",
  get_news: "News",
  what_if_add: "What-if add",
  run_stress: "Stress scenario",
};

export function AssistantPanel({ portfolioId }: { portfolioId: string }) {
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<{
    id: string;
    asked: string;
    result?: AssistantResult;
    error?: string;
    busy?: boolean;
  } | null>(null);
  const current = state?.id === portfolioId ? state : null;
  const [thread, setThread] = useState<{
    id: string;
    turns: { question: string; answer: string }[];
  }>({
    id: portfolioId,
    turns: [],
  });
  // Earlier turns belong to one portfolio; switching portfolios starts a fresh conversation.
  const turns = thread.id === portfolioId ? thread.turns : [];

  async function ask(text: string) {
    const q = text.trim();
    if (q.length < 3) return;
    setState({ id: portfolioId, asked: q, busy: true });
    try {
      const result = await api<AssistantResult>(`/api/portfolios/${portfolioId}/assistant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, history: turns.slice(-4) }),
      });
      setState({ id: portfolioId, asked: q, result });
      // Only verified answers are carried forward as context.
      if (result.result.source === "model")
        setThread({
          id: portfolioId,
          turns: [...turns, { question: q, answer: result.result.answer }].slice(-4),
        });
    } catch (e) {
      setState({
        id: portfolioId,
        asked: q,
        error: e instanceof Error ? e.message : "Something went wrong",
      });
    }
  }

  const r = current?.result?.result;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ask about your portfolio</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            aria-label="Your question"
            maxLength={500}
            placeholder="Ask a question about your portfolio or a company"
            className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2"
          />
          <Button type="submit" disabled={current?.busy || question.trim().length < 3}>
            {current?.busy ? "Working" : "Ask"}
          </Button>
        </form>
        <div role="group" aria-label="Suggested questions" className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={current?.busy}
              onClick={() => {
                setQuestion(s);
                void ask(s);
              }}
              className="rounded-full border px-3 py-1 text-xs hover:bg-muted"
            >
              {s}
            </button>
          ))}
        </div>

        {turns.length > 1 && (
          <details>
            <summary className="cursor-pointer text-muted-foreground">
              Earlier in this conversation ({turns.length - 1})
            </summary>
            <ul aria-label="Earlier questions" className="mt-2 space-y-2">
              {turns.slice(0, -1).map((t, i) => (
                <li key={i}>
                  <div className="font-medium">{t.question}</div>
                  <div className="text-muted-foreground">{withCitations(t.answer)}</div>
                </li>
              ))}
            </ul>
          </details>
        )}
        {current?.error && (
          <p role="alert" className="text-destructive">
            {current.error}
          </p>
        )}
        {r && (
          <div aria-label="Assistant answer" role="region" className="space-y-3">
            {r.source === "fallback" && (
              <p className="text-muted-foreground">
                The written answer could not be verified against the numbers, so only the figures
                are shown.
              </p>
            )}
            <p>{withCitations(r.answer)}</p>
            {r.toolCalls.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Looked at:{" "}
                {[...new Set(r.toolCalls.map((t) => TOOL_LABEL[t.name] ?? t.name))].join(", ")}
              </p>
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
            <p className="text-xs text-muted-foreground">{current?.result?.disclaimer}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
