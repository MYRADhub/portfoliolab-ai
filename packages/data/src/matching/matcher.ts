export interface AliasEntry {
  companyId: number;
  alias: string;
  ambiguous: boolean;
}

export interface TickerEntry {
  companyId: number;
  ticker: string;
}

export interface Match {
  companyId: number;
  score: number;
  /** Distinct evidence, for audit: aliases or ticker forms found. */
  evidence: string[];
}

export const SCORE_TICKER = 0.95;
export const SCORE_MULTI_WORD = 0.9;
export const SCORE_SINGLE_WORD = 0.8;
export const SCORE_AMBIGUOUS = 0.3;
/** Links scoring below this are weak enough that consumers should not treat them as a company mention. */
export const MIN_LINK_SCORE = 0.5;

export const FIELD_WEIGHT = { title: 1, snippet: 0.9, body: 0.7 } as const;
export type Field = keyof typeof FIELD_WEIGHT;

interface Token {
  text: string;
}

const MAX_ALIAS_WORDS = 5;

function tokenize(text: string): Token[] {
  return text
    .split(/\s+/)
    .map((raw) => raw.replace(/^[("'“‘[]+|[)"'”’\].,;:!?]+$/g, "").replace(/(['’]s)$/i, ""))
    .filter(Boolean)
    .map((text) => ({ text }));
}

const isAllCaps = (s: string) => /[A-Z]/.test(s) && s === s.toUpperCase();

export class AliasIndex {
  private readonly byLower = new Map<string, AliasEntry[]>();
  private readonly tickers = new Map<string, number>();
  private maxWords = 1;

  constructor(aliases: readonly AliasEntry[], tickers: readonly TickerEntry[]) {
    for (const a of aliases) {
      const key = a.alias.toLowerCase();
      const list = this.byLower.get(key) ?? [];
      list.push(a);
      this.byLower.set(key, list);
      this.maxWords = Math.max(this.maxWords, Math.min(MAX_ALIAS_WORDS, a.alias.split(" ").length));
    }
    for (const t of tickers) this.tickers.set(t.ticker.toUpperCase(), t.companyId);
  }

  /** Finds company mentions in one text field. Returns the best score per company and the evidence used. */
  private scanField(text: string): Map<number, Map<string, number>> {
    const found = new Map<number, Map<string, number>>();
    const note = (companyId: number, evidence: string, score: number) => {
      const m = found.get(companyId) ?? new Map<string, number>();
      m.set(evidence, Math.max(m.get(evidence) ?? 0, score));
      found.set(companyId, m);
    };

    const tokens = tokenize(text);
    for (let i = 0; i < tokens.length; i++) {
      for (let n = Math.min(this.maxWords, tokens.length - i); n >= 1; n--) {
        const phrase = tokens
          .slice(i, i + n)
          .map((t) => t.text)
          .join(" ");
        const entries = this.byLower.get(phrase.toLowerCase());
        if (!entries) continue;
        for (const e of entries) {
          // Case-aware: all-caps aliases (AES, AT&T, 3M) need an exact match; others need a capitalized start.
          const exact =
            isAllCaps(e.alias) || /\d/.test(e.alias)
              ? phrase === e.alias
              : /^[A-Z0-9]/.test(phrase);
          if (!exact) continue;
          const score = e.ambiguous
            ? SCORE_AMBIGUOUS
            : n > 1
              ? SCORE_MULTI_WORD
              : SCORE_SINGLE_WORD;
          note(e.companyId, e.alias, score);
        }
        break; // longest match wins at this position
      }
    }

    // $NVDA and (NASDAQ: NVDA) forms. A bare (NVDA) needs two or more letters to avoid list markers like "(A)".
    for (const m of text.matchAll(/\$([A-Z]{1,5}(?:\.[A-Z])?)\b/g))
      this.noteTicker(m[1]!, `$${m[1]}`, note);
    for (const m of text.matchAll(
      /\(\s*(?:NASDAQ|NYSE|NYSEARCA|NYSEMKT|AMEX)\s*:\s*([A-Z]{1,5}(?:\.[A-Z])?)\s*\)/g,
    )) {
      this.noteTicker(m[1]!, `exchange:${m[1]}`, note);
    }
    for (const m of text.matchAll(/\(\s*([A-Z]{2,5}(?:\.[A-Z])?)\s*\)/g))
      this.noteTicker(m[1]!, `(${m[1]})`, note);
    return found;
  }

  private noteTicker(
    ticker: string,
    evidence: string,
    note: (id: number, ev: string, score: number) => void,
  ) {
    const id = this.tickers.get(ticker);
    if (id !== undefined) note(id, evidence, SCORE_TICKER);
  }

  /**
   * Company mentions across fields. Evidence is deduplicated per alias taking its best field-weighted score,
   * then combined as a noisy-or so independent evidence reinforces and a single weak hit stays weak.
   */
  match(fields: Partial<Record<Field, string | null | undefined>>): Match[] {
    const best = new Map<number, Map<string, number>>();
    for (const field of Object.keys(FIELD_WEIGHT) as Field[]) {
      const text = fields[field];
      if (!text) continue;
      for (const [companyId, evidence] of this.scanField(text)) {
        const m = best.get(companyId) ?? new Map<string, number>();
        for (const [ev, score] of evidence)
          m.set(ev, Math.max(m.get(ev) ?? 0, score * FIELD_WEIGHT[field]));
        best.set(companyId, m);
      }
    }
    return [...best.entries()]
      .map(([companyId, evidence]) => {
        const miss = [...evidence.values()].reduce((a, s) => a * (1 - s), 1);
        return {
          companyId,
          score: Math.min(0.99, 1 - miss),
          evidence: [...evidence.keys()].sort(),
        };
      })
      .sort((a, b) => b.score - a.score || a.companyId - b.companyId);
  }
}
