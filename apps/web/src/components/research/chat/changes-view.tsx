"use client";

import type { StoredAnswer } from "@/server/research-chat";

/** What moved between an earlier answer and its refresh, computed by matching the figures, not by the model. */
export function ChangesView({ refresh }: { refresh: NonNullable<StoredAnswer["refresh"]> }) {
  const c = refresh.changes;
  const since = refresh.since.slice(0, 10);
  const nothing = !c.changed.length && !c.added.length && !c.removed.length;
  return (
    <section
      aria-label="What changed"
      className="mb-4 space-y-2 rounded-lg border bg-muted/40 p-3 text-xs"
    >
      <h3 className="text-sm font-medium">What changed since {since}</h3>
      <p className="text-muted-foreground">
        {c.changed.length} figures changed, {c.added.length} new, {c.removed.length} no longer
        found, {c.unchanged} the same.
      </p>
      {nothing && <p>The figures are the same as before.</p>}
      {c.changed.length > 0 && (
        <table className="w-full text-left">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Figure</th>
              <th className="py-1 pr-2 font-medium">Before</th>
              <th className="py-1 font-medium">Now</th>
            </tr>
          </thead>
          <tbody>
            {c.changed.slice(0, 12).map((x) => (
              <tr key={x.label} className="border-t align-top">
                <td className="py-1 pr-2">{x.label}</td>
                <td className="py-1 pr-2 tabular-nums">{x.before}</td>
                <td className="py-1 font-medium tabular-nums">{x.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {c.added.length > 0 && (
        <details>
          <summary className="cursor-pointer">New since then ({c.added.length})</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {c.added.slice(0, 12).map((x) => (
              <li key={x.label}>
                {x.label}: {x.text.slice(0, 160)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {c.removed.length > 0 && (
        <details>
          <summary className="cursor-pointer">No longer found ({c.removed.length})</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {c.removed.slice(0, 12).map((x) => (
              <li key={x.label}>
                {x.label}: {x.text.slice(0, 160)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
