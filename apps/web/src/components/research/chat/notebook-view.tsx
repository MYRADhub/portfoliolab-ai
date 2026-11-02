"use client";

import { Presentation, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Loading } from "@/components/ui/skeleton";
import { api, ensureSession } from "@/lib/api";
import type { Pin } from "@/server/research-notebook";
import { AnswerView } from "./answer-view";
import { DisplayView } from "./display-view";

/** One notebook per portfolio plus General: pinned answers and charts with notes, ready to present. */
export function NotebookView() {
  const [portfolios, setPortfolios] = useState<{ id: string; name: string }[] | null>(null);
  const [portfolioId, setPortfolioId] = useState<string | null>(null);
  // Pins are kept with the notebook they were loaded for, so switching notebooks shows loading without a reset.
  const [loaded, setLoaded] = useState<{ key: string; pins: Pin[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureSession()
      .then(() => api<{ portfolios: { id: string; name: string }[] }>("/api/portfolios"))
      .then((r) => setPortfolios(r.portfolios))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  const query = portfolioId ? `?portfolioId=${portfolioId}` : "";
  const pins = loaded?.key === query ? loaded.pins : null;
  const setPins = (f: (ps: Pin[] | null) => Pin[] | null) =>
    setLoaded((l) => (l ? { key: l.key, pins: f(l.pins) ?? [] } : l));
  useEffect(() => {
    let cancelled = false;
    ensureSession()
      .then(() => api<{ pins: Pin[] }>(`/api/research/notebook${query}`))
      .then((r) => !cancelled && setLoaded({ key: query, pins: r.pins }))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, [query]);

  async function remove(id: number) {
    try {
      await api(`/api/research/notebook/${id}`, { method: "DELETE" });
      setPins((ps) => ps?.filter((p) => p.id !== id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove it");
    }
  }

  async function saveNote(id: number, note: string) {
    try {
      await api(`/api/research/notebook/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: note || null }),
      });
      setPins((ps) => ps?.map((p) => (p.id === id ? { ...p, note: note || null } : p)) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the note");
    }
  }

  return (
    <section className="space-y-5">
      <Link href="/research" className="text-sm text-muted-foreground hover:underline">
        Back to Research
      </Link>
      <PageHeader
        title="Research notebook"
        description="Answers and charts you pinned, with your notes. Each portfolio has its own notebook; General holds the rest."
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Notebook
          <select
            value={portfolioId ?? ""}
            onChange={(e) => setPortfolioId(e.target.value || null)}
            className="rounded-md border bg-background px-2 py-1"
          >
            <option value="">General</option>
            {(portfolios ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {pins && pins.length > 0 && (
          <Link
            href={`/research/notebook/deck${query}`}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm hover:bg-muted"
          >
            <Presentation className="size-4" aria-hidden /> Presentation
          </Link>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!pins && <Loading rows={2} />}
      {pins && pins.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing pinned yet. Use &quot;Pin to notebook&quot; under an answer, or &quot;Pin
          chart&quot; in its charts. Pins go to the notebook of the portfolio selected in the chat.
        </p>
      )}
      <ol className="space-y-4" aria-label="Pinned items">
        {(pins ?? []).map((p) => {
          const chart = p.displayId
            ? (p.answer.allDisplays ?? p.answer.displays).find((d) => d.id === p.displayId)
            : null;
          return (
            <li key={p.id} className="space-y-3 rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-medium">{p.question || p.thread.title}</h2>
                  <p className="text-xs text-muted-foreground">
                    {chart ? "Chart" : "Answer"} pinned {p.createdAt.slice(0, 10)} from{" "}
                    <Link
                      href={`/research?thread=${p.thread.id}`}
                      className="underline underline-offset-2"
                    >
                      {p.thread.title}
                    </Link>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void remove(p.id)}
                  aria-label={`Remove pin: ${p.question || p.thread.title}`}
                  className="rounded p-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              {chart ? <DisplayView display={chart} size="lg" /> : <AnswerView answer={p.answer} />}
              <label className="block space-y-1 text-xs text-muted-foreground">
                Your note
                <textarea
                  defaultValue={p.note ?? ""}
                  maxLength={2000}
                  rows={2}
                  onBlur={(e) => {
                    if ((e.target.value || null) !== p.note) void saveNote(p.id, e.target.value);
                  }}
                  className="block w-full rounded-md border bg-background px-2 py-1 text-sm text-foreground"
                />
              </label>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
