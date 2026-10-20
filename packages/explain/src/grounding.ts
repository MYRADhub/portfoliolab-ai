import type { Fact } from "./facts";

export interface GroundingIssue {
  kind: "ungrounded_number" | "unknown_citation" | "advice" | "empty";
  detail: string;
}

const CITATION = /\[\s*F\d+(?:\s*,\s*F\d+)*\s*\]/g;
const NUMBER = /\d+(?:[.,]\d+)*/g;

/**
 * Directive wording we never allow: the product frames results as research, not instructions.
 * Matches "you should buy", "we recommend selling", "sell your", and similar.
 */
const VERBS =
  "buy(?:ing)?|sell(?:ing)?|short(?:ing)?|hold(?:ing)?|add(?:ing)?|reduc(?:e|ing)|trim(?:ming)?|exit(?:ing)?";
const ADVICE = new RegExp(
  `\\b(?:you\\s+should|you\\s+must|we\\s+recommend|i\\s+recommend|consider)\\s+(?:to\\s+)?(?:${VERBS})\\b|\\b(?:buy|sell)\\s+(?:now|immediately|your)\\b`,
  "i",
);
function canonical(token: string): string {
  const n = Number(token.replace(/,/g, ""));
  return Number.isFinite(n) ? String(n) : token;
}

/** Numeric magnitudes appearing in fact labels and texts, sign ignored ("-3.8%" allows "3.8"). Labels count because the model and the reader both see them. */
export function allowedNumbers(facts: readonly Fact[]): Set<string> {
  const set = new Set<string>();
  for (const f of facts)
    for (const m of `${f.label} ${f.text}`.matchAll(NUMBER)) set.add(canonical(m[0]));
  return set;
}

export function citedIds(text: string): string[] {
  return [...text.matchAll(CITATION)].flatMap((m) => [...m[0].matchAll(/F\d+/g)].map((x) => x[0]));
}

/** Checks that every digit-bearing number in `text` appears in the facts, every citation exists, and no advice. */
export function checkGrounding(text: string, facts: readonly Fact[]): GroundingIssue[] {
  const issues: GroundingIssue[] = [];
  if (!text.trim()) return [{ kind: "empty", detail: "empty text" }];

  const ids = new Set(facts.map((f) => f.id));
  for (const id of new Set(citedIds(text))) {
    if (!ids.has(id)) issues.push({ kind: "unknown_citation", detail: id });
  }

  const allowed = allowedNumbers(facts);
  const body = text.replace(CITATION, " ");
  const seen = new Set<string>();
  for (const m of body.matchAll(NUMBER)) {
    const c = canonical(m[0]);
    if (!allowed.has(c) && !seen.has(c)) {
      seen.add(c);
      issues.push({ kind: "ungrounded_number", detail: m[0] });
    }
  }

  if (ADVICE.test(body))
    issues.push({ kind: "advice", detail: "contains a buy/sell/hold directive" });
  return issues;
}
