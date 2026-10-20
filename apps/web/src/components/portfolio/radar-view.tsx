"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { formatAge, pct } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { Radar, RadarItem } from "@/server/radar";
import { WithPortfolio } from "./with-portfolio";

const DAYS = [1, 3, 7, 14, 30];
const CLASSES = [
  { value: "", label: "All types" },
  { value: "fundamental", label: "Fundamental" },
  { value: "narrative", label: "Narrative" },
  { value: "noise", label: "Noise" },
  { value: "unclear", label: "Unclear" },
  { value: "unclassified", label: "Not yet classified" },
];

export function RadarView() {
  return <WithPortfolio>{(id) => <Content id={id} />}</WithPortfolio>;
}

function Content({ id }: { id: string }) {
  const [days, setDays] = useState(7);
  const [cls, setCls] = useState("");
  const [ticker, setTicker] = useState("");
  const query = new URLSearchParams({
    days: String(days),
    ...(cls ? { class: cls } : {}),
    ...(ticker ? { ticker } : {}),
  });
  const { data, error } = useApi<Radar>(`/api/portfolios/${id}/radar?${query}`);
  const filtered = cls !== "" || ticker !== "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          Period
          <select
            className="rounded-md border bg-background px-2 py-1"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {DAYS.map((d) => (
              <option key={d} value={d}>
                Last {d} {d === 1 ? "day" : "days"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Type
          <select
            className="rounded-md border bg-background px-2 py-1"
            value={cls}
            onChange={(e) => setCls(e.target.value)}
          >
            {CLASSES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Holding
          <select
            className="rounded-md border bg-background px-2 py-1"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
          >
            <option value="">All holdings</option>
            {(data?.holdings ?? []).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {filtered && (
          <button
            type="button"
            className="underline"
            onClick={() => {
              setCls("");
              setTicker("");
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!data && !error && <p className="text-muted-foreground">Loading</p>}

      {data && <Results data={data} filtered={filtered} />}
    </div>
  );
}

function Results({ data, filtered }: { data: Radar; filtered: boolean }) {
  const shown = data.items.filter((i) => i.relevance.score >= data.threshold);
  const collapsed = data.items.filter((i) => i.relevance.score < data.threshold);

  if (data.counts.total === 0) {
    return (
      <p className="text-muted-foreground">
        {filtered
          ? "No items match these filters."
          : `No news matched your holdings in the last ${data.days} ${data.days === 1 ? "day" : "days"}. News appears here once it has been collected for companies you hold.`}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {data.counts.total} {data.counts.total === 1 ? "item" : "items"}: {data.counts.shown} shown,{" "}
        {data.counts.collapsed} collapsed as low relevance. Relevance is a 0 to 10 score for this
        portfolio based on which holdings an article is about, how much it could change their
        economics, and how fresh it is.
      </p>
      <ul className="space-y-3" aria-label="Ranked news">
        {shown.map((item) => (
          <Item key={item.url} item={item} />
        ))}
      </ul>
      {collapsed.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">
            {collapsed.length} low-relevance {collapsed.length === 1 ? "item" : "items"}
          </summary>
          <ul className="mt-3 space-y-3" aria-label="Low-relevance news">
            {collapsed.map((item) => (
              <Item key={item.url} item={item} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Item({ item }: { item: RadarItem }) {
  const r = item.relevance;
  const c = item.classification;
  return (
    <li>
      <Card>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-start gap-3">
            <div
              className="shrink-0 rounded-md border px-2 py-1 text-center"
              aria-label={`Relevance ${r.score.toFixed(1)} out of 10`}
            >
              <div className="text-lg font-semibold tabular-nums">{r.score.toFixed(1)}</div>
              <div className="text-xs text-muted-foreground">of 10</div>
            </div>
            <div className="min-w-0 space-y-1">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline"
              >
                {item.title}
              </a>
              <div className="text-muted-foreground">
                {r.matched.map((m) => `${m.ticker} (${pct(m.weight, 0)} of portfolio)`).join(", ")}
                {item.source ? ` | ${item.source}` : ""} | {formatAge(item.ageDays)}
                {item.copies > 0 ? ` | ${item.copies} similar` : ""}
              </div>
              <div className="text-muted-foreground">
                {c
                  ? `${c.class}, importance ${c.fundamentalImportance} of 10`
                  : "Not yet classified"}
              </div>
            </div>
          </div>
          <details>
            <summary className="cursor-pointer text-muted-foreground">
              Why am I seeing this?
            </summary>
            <ul className="mt-2 space-y-1">
              <li>
                Holdings touched: {pct(r.exposureMatch, 0)} (
                {r.matched
                  .map(
                    (m) =>
                      `${m.ticker}: ${pct(m.linkScore, 0)} sure it is about them, ${pct(m.weight, 0)} of your portfolio`,
                  )
                  .join("; ")}
                )
              </li>
              <li>
                Economic impact: {pct(r.impact, 0)}
                {c ? ` (${c.mechanism})` : " (not yet classified, so a neutral 50%)"}
              </li>
              <li>Freshness: {pct(r.recency, 0)} (half the relevance is lost every 3 days)</li>
              <li>Score = 10 x holdings touched x impact x freshness = {r.score.toFixed(1)}</li>
            </ul>
          </details>
        </CardContent>
      </Card>
    </li>
  );
}
