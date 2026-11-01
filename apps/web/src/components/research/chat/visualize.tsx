"use client";

import type { Fact, ShownDisplay } from "@portfolio-lab/explain";
import { DisplayView } from "./display-view";

/** A fact whose value is a single short figure ("+42.0%", "$200.0B", "18.4%", "35.2"). Those make stat tiles. */
const FIGURE = /^[+-]?\$?\d[\d,]*(?:\.\d+)?(?:%|[KMBT])?(?:\s+on\s+\d{4}-\d{2}-\d{2})?$/;

export function statFacts(facts: readonly Fact[], max = 12): Fact[] {
  const seen = new Set<string>();
  return facts
    .filter((f) => (f.kind ?? "data") === "data" && FIGURE.test(f.text.trim()))
    .filter((f) => !seen.has(f.label) && seen.add(f.label))
    .slice(0, max);
}

export function StatTiles({ facts }: { facts: readonly Fact[] }) {
  const tiles = statFacts(facts);
  if (!tiles.length) return null;
  return (
    <div
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
      role="group"
      aria-label="Key figures"
    >
      {tiles.map((f) => (
        <div key={f.id} className="rounded-lg border px-3 py-2">
          <div className="text-[0.7rem] leading-tight text-muted-foreground">{f.label}</div>
          <div
            className={`text-base font-semibold tabular-nums ${
              f.text.startsWith("+") ? "text-gain" : f.text.startsWith("-") ? "text-loss" : ""
            }`}
          >
            {f.text}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Every chart and table behind one answer, with its key figures, laid out as a dashboard. */
export function AnswerDashboard({
  facts,
  displays,
}: {
  facts: readonly Fact[];
  displays: readonly ShownDisplay[];
}) {
  const wide = (d: ShownDisplay) =>
    d.kind === "table" || d.kind === "heatmap" || (d.kind === "bar" && d.categories.length > 6);
  return (
    <div className="space-y-4">
      <StatTiles facts={facts} />
      {displays.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {displays.map((d) => (
            <div key={d.id} className={wide(d) ? "lg:col-span-2" : ""}>
              <DisplayView display={d} size="lg" />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No charts were produced for this answer.</p>
      )}
    </div>
  );
}
