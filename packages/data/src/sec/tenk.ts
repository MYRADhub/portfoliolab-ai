import { z } from "zod";
import { ProviderError } from "../providers/types";
import type { EdgarClient } from "./edgar";
import type { Filing } from "./filings";

const recentSchema = z.object({
  accessionNumber: z.array(z.string()),
  filingDate: z.array(z.string()),
  acceptanceDateTime: z.array(z.string()),
  form: z.array(z.string()),
  primaryDocument: z.array(z.string()),
  reportDate: z.array(z.string()).optional(),
});
const submissionsSchema = z.object({ filings: z.object({ recent: recentSchema }) });

export interface TenK extends Filing {
  /** The fiscal period the report covers (YYYY-MM-DD), when EDGAR states it. */
  reportDate: string | null;
}

/**
 * The newest annual report (Form 10-K, amendments excluded) filed strictly before `filedBefore`, or null. Using a
 * report from before the period being tested keeps what it says from describing that period after the fact.
 */
export function latestTenKBefore(raw: unknown, filedBefore: string): TenK | null {
  const parsed = submissionsSchema.safeParse(raw);
  if (!parsed.success)
    throw new ProviderError("sec", "unexpected submissions shape", "bad_response");
  const r = parsed.data.filings.recent;
  let best: TenK | null = null;
  for (let i = 0; i < r.accessionNumber.length; i++) {
    if (r.form[i] !== "10-K") continue;
    const filingDate = r.filingDate[i]!;
    if (filingDate >= filedBefore) continue;
    if (best && filingDate <= best.filingDate) continue;
    const acceptedAt = new Date(r.acceptanceDateTime[i]!);
    if (Number.isNaN(acceptedAt.getTime())) continue;
    best = {
      accession: r.accessionNumber[i]!,
      acceptedAt,
      filingDate,
      form: "10-K",
      items: [],
      primaryDocument: r.primaryDocument[i] ?? "",
      reportDate: r.reportDate?.[i] || null,
    };
  }
  return best;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  ndash: "-",
  mdash: "-",
  bull: "*",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Plain text of an HTML filing: hidden inline-XBRL data, scripts and tags removed, paragraphs kept as line breaks. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6]|\/table)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n[ \n]*/g, "\n")
    .trim();
}

/** The longest stretch from a start heading to the next end heading. Short stretches are table-of-contents entries. */
function longestSection(text: string, start: RegExp, end: RegExp): string {
  let best = "";
  for (const m of text.matchAll(start)) {
    const from = m.index! + m[0].length;
    const rest = text.slice(from);
    const stop = rest.search(end);
    const body = (stop === -1 ? rest : rest.slice(0, stop)).trim();
    if (body.length > best.length) best = body;
  }
  return best;
}

function firstWords(s: string, n: number): string {
  const words = s.split(/(?<=\s)/);
  return words.length <= n ? s : words.slice(0, n).join("").trimEnd();
}

/** Words of each section kept for drafting: enough to describe the business, short enough to keep runs cheap. */
export const BUSINESS_WORDS = 3500;
export const RISK_WORDS = 2500;
/** A section shorter than this is a table-of-contents entry, not the section itself. */
export const MIN_SECTION_WORDS = 150;

export interface TenKSections {
  business: string;
  risks: string;
}

/**
 * Item 1 (Business) and Item 1A (Risk Factors) of a 10-K, each cut to its first words. Either is empty when the
 * report does not use the standard headings.
 */
export function extractTenKSections(html: string): TenKSections {
  const text = htmlToText(html);
  // Headings stand on their own line; the same words inside a sentence are cross-references, not section starts.
  const business = longestSection(
    text,
    /^item\s*1\s*[.:-]?\s*business\s*\.?\s*$/gim,
    /^item\s*1a\s*[.:-]?\s*risk\s+factors\s*\.?\s*$/im,
  );
  const risks = longestSection(
    text,
    /^item\s*1a\s*[.:-]?\s*risk\s+factors\s*\.?\s*$/gim,
    /^item\s*(1b|1c|2)\s*[.:-]?\s*(unresolved|cybersecurity|properties)/im,
  );
  // Some reports drop the Item headings from the body (they appear only in the table of contents). Fall back to the
  // first overview heading for the business and the first "Risks related to" heading for the risks.
  const words = (s: string) => (s ? s.split(/\s+/).length : 0);
  // The text after the first match of `re` that is not a table-of-contents line (one followed by a page number).
  const after = (re: RegExp) => {
    for (const m of text.matchAll(new RegExp(re.source, "gim"))) {
      const rest = text.slice(m.index! + m[0].length).replace(/^\n/, "");
      if (!/^\d+\s*(\n|$)/.test(rest)) return rest.trim();
    }
    return "";
  };
  const b =
    (words(business) < MIN_SECTION_WORDS &&
      after(/^(overview|introduction|our company|company overview|general)\s*$/im)) ||
    business;
  const r =
    (words(risks) < MIN_SECTION_WORDS && after(/^(?=risks? (related|relating) to\b)/im)) || risks;
  return { business: firstWords(b, BUSINESS_WORDS), risks: firstWords(r, RISK_WORDS) };
}

/** Lowercased, punctuation-free, single-spaced text, so a quote can be found despite spacing or quote-mark changes. */
export function normalizeForQuote(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, "")
    .replace(/[^a-z0-9%$]+/g, " ")
    .trim();
}

/** Minimum words a quote needs, so a stray common phrase cannot pass as evidence. */
export const MIN_QUOTE_WORDS = 6;

/** True when `quote` appears in `source` word for word, ignoring case, spacing and punctuation. */
export function quoteAppearsIn(quote: string, source: string): boolean {
  const q = normalizeForQuote(quote);
  if (q.split(" ").length < MIN_QUOTE_WORDS) return false;
  return normalizeForQuote(source).includes(q);
}

const pagesSchema = z.object({
  filings: z.object({
    files: z.array(z.object({ name: z.string(), filingFrom: z.string() })).optional(),
  }),
});

/**
 * The newest 10-K filed before `filedBefore`, looking past the most recent filings into older pages of the history
 * when needed: companies that file often push their annual reports out of the first page.
 */
export async function findTenKBefore(
  edgar: Pick<EdgarClient, "submissions" | "submissionsPage">,
  cik: string,
  filedBefore: string,
): Promise<TenK | null> {
  const first = await edgar.submissions(cik);
  const found = latestTenKBefore(first, filedBefore);
  if (found) return found;
  const files = pagesSchema.safeParse(first).data?.filings.files ?? [];
  for (const f of files) {
    if (f.filingFrom >= filedBefore) continue;
    const page = await edgar.submissionsPage(f.name);
    const k = latestTenKBefore({ filings: { recent: page } }, filedBefore);
    if (k) return k;
  }
  return null;
}
