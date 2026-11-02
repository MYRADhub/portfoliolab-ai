import { normalizeForQuote } from "./tenk";

/** Lines shorter than this are headings or table fragments, not paragraphs worth comparing. */
export const MIN_PARAGRAPH_WORDS = 8;
/** At or above this word overlap a paragraph is the same paragraph; between REWORDED and this it was reworded. */
export const SAME = 0.9;
export const REWORDED = 0.5;
/** A sentence this close to an older one counts as an edit of it, not a new sentence. */
export const SENTENCE_SAME = 0.8;

const wordSet = (t: string) => new Set(normalizeForQuote(t).split(" ").filter(Boolean));

export interface Paragraph {
  index: number;
  text: string;
  words: Set<string>;
}

export interface ParagraphChange {
  kind: "added" | "removed" | "reworded";
  /** The paragraph in the newer filing (added, reworded) or the older one (removed). */
  text: string;
  /** For a reworded paragraph: the older wording and the sentences that are new in it. */
  previous?: string;
  newSentences?: string[];
  similarity?: number;
}

export interface FilingDiff {
  counts: { unchanged: number; reworded: number; added: number; removed: number };
  words: { before: number; after: number };
  changes: ParagraphChange[];
}

export function paragraphs(text: string): Paragraph[] {
  return text
    .split(/\n+/)
    .map((t) => t.trim())
    .filter((t) => t.split(/\s+/).length >= MIN_PARAGRAPH_WORDS)
    .map((t, index) => ({
      index,
      text: t,
      words: wordSet(t),
    }));
}

/** Share of distinct words two paragraphs have in common (Jaccard). */
export function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"(])/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 4);
}

/**
 * Compares two versions of a filing section paragraph by paragraph. Each newer paragraph is matched to its closest
 * older one: very close is unchanged, fairly close is reworded (with the sentences that are new), otherwise added.
 * Older paragraphs no newer one came close to were removed. Pure text comparison; it does not judge importance.
 */
export function diffSections(before: string, after: string): FilingDiff {
  const old = paragraphs(before);
  const neu = paragraphs(after);
  const matched = new Set<number>();
  const changes: ParagraphChange[] = [];
  const counts = { unchanged: 0, reworded: 0, added: 0, removed: 0 };

  for (const p of neu) {
    let best = -1;
    let bestScore = 0;
    for (const o of old) {
      const s = overlap(p.words, o.words);
      if (s > bestScore) {
        bestScore = s;
        best = o.index;
      }
    }
    if (bestScore >= SAME) {
      counts.unchanged++;
      matched.add(best);
    } else if (bestScore >= REWORDED) {
      counts.reworded++;
      matched.add(best);
      const prev = old[best]!.text;
      const had = sentences(prev).map(wordSet);
      changes.push({
        kind: "reworded",
        text: p.text,
        previous: prev,
        // A sentence with only small edits is not new: it must differ from every older sentence by more than that.
        newSentences: sentences(p.text).filter((x) => {
          const w = wordSet(x);
          return !had.some((h) => overlap(w, h) >= SENTENCE_SAME);
        }),
        similarity: bestScore,
      });
    } else {
      counts.added++;
      changes.push({ kind: "added", text: p.text });
    }
  }
  for (const o of old)
    if (!matched.has(o.index)) {
      // A paragraph merged into a larger one can still be close to some newer paragraph.
      const close = neu.some((p) => overlap(p.words, o.words) >= REWORDED);
      if (close) continue;
      counts.removed++;
      changes.push({ kind: "removed", text: o.text });
    }
  const wc = (ps: Paragraph[]) => ps.reduce((n, p) => n + p.text.split(/\s+/).length, 0);
  return { counts, words: { before: wc(old), after: wc(neu) }, changes };
}
