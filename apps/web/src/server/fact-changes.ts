import type { Fact } from "@portfolio-lab/explain";

export interface FactChanges {
  /** Same figure, new value. */
  changed: { label: string; before: string; after: string }[];
  /** Figures found now that the earlier answer did not have. */
  added: { label: string; text: string }[];
  /** Figures the earlier answer had that were not found this time. */
  removed: { label: string; text: string }[];
  unchanged: number;
}

/** A label with its dates taken out, so "close on 2026-10-26" and "close on 2026-11-02" are the same figure. */
export function factKey(label: string): string {
  return label
    .replace(/\d{4}-\d{2}-\d{2}/g, "<date>")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Compares the facts behind an earlier answer with those behind a fresh one, by label. Dates inside the values are
 * compared too, so a figure whose window moved shows as changed. Order follows the fresh answer.
 */
export function compareFacts(before: readonly Fact[], after: readonly Fact[]): FactChanges {
  const old = new Map<string, Fact>();
  for (const f of before) if (!old.has(factKey(f.label))) old.set(factKey(f.label), f);
  const seen = new Set<string>();
  const out: FactChanges = { changed: [], added: [], removed: [], unchanged: 0 };
  for (const f of after) {
    const k = factKey(f.label);
    if (seen.has(k)) continue;
    seen.add(k);
    const o = old.get(k);
    if (!o) out.added.push({ label: f.label, text: f.text });
    else if (o.text.trim() === f.text.trim()) out.unchanged++;
    else out.changed.push({ label: f.label, before: o.text, after: f.text });
  }
  for (const [k, o] of old) if (!seen.has(k)) out.removed.push({ label: o.label, text: o.text });
  return out;
}
