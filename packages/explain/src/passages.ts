export const PASSAGE_WORDS = 110;

export interface Passage {
  /** 1-based position in the document. */
  index: number;
  text: string;
}

const STOP = new Set(
  "the a an and or of to in on for with by at from as is are was were be been it its this that these those what how why which who does do did about".split(
    " ",
  ),
);

function terms(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9%$]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Splits text into passages of about `size` words, breaking at sentence ends when one is near. */
export function splitPassages(text: string, size = PASSAGE_WORDS): Passage[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: Passage[] = [];
  let start = 0;
  while (start < words.length) {
    let end = Math.min(words.length, start + size);
    // Extend up to a quarter of a passage to finish the sentence.
    for (let j = end; j < Math.min(words.length, end + Math.floor(size / 4)); j++) {
      if (/[.!?]["')\]]?$/.test(words[j - 1]!)) {
        end = j;
        break;
      }
    }
    out.push({ index: out.length + 1, text: words.slice(start, end).join(" ") });
    start = end;
  }
  return out;
}

/**
 * The passages most about `focus`, scored by how many distinct focus terms they contain and how often, returned in
 * document order. With no focus, the first passages.
 */
export function pickPassages(text: string, focus: string | undefined, max = 6): Passage[] {
  const all = splitPassages(text);
  const want = [...new Set(terms(focus ?? ""))];
  if (want.length === 0) return all.slice(0, max);
  const scored = all.map((p) => {
    const have = terms(p.text);
    const counts = new Map<string, number>();
    for (const w of have) counts.set(w, (counts.get(w) ?? 0) + 1);
    const distinct = want.filter((w) => counts.has(w)).length;
    const total = want.reduce((n, w) => n + Math.min(3, counts.get(w) ?? 0), 0);
    return { p, score: distinct * 10 + total };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.p.index - b.p.index)
    .slice(0, max)
    .map((s) => s.p)
    .sort((a, b) => a.index - b.index);
}
