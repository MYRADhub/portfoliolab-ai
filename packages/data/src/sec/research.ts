import { z } from "zod";
import { ProviderError } from "../providers/types";
import { htmlToText, longestSection, MIN_SECTION_WORDS } from "./tenk";

/** Filings worth reading for research: annual, quarterly and current reports, proxies and their foreign equivalents. */
export const RESEARCH_FORMS = [
  "10-K",
  "10-Q",
  "8-K",
  "20-F",
  "40-F",
  "6-K",
  "DEF 14A",
  "S-1",
] as const;

export interface FilingRef {
  accession: string;
  form: string;
  filingDate: string;
  reportDate: string | null;
  primaryDocument: string;
  description: string | null;
  url: string;
}

const recentSchema = z.object({
  accessionNumber: z.array(z.string()),
  filingDate: z.array(z.string()),
  form: z.array(z.string()),
  primaryDocument: z.array(z.string()),
  reportDate: z.array(z.string()).optional(),
  primaryDocDescription: z.array(z.string()).optional(),
  items: z.array(z.string()).optional(),
});
const submissionsSchema = z.object({ filings: z.object({ recent: recentSchema }) });

export function archiveUrl(cik: string, accession: string, document: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${String(Number(cik))}/${accession.replace(/-/g, "")}/${document}`;
}

/** The newest filings of the given forms from a submissions response, newest first. Amendments are left out. */
export function recentFilings(
  raw: unknown,
  cik: string,
  forms: readonly string[],
  limit = 10,
): FilingRef[] {
  const parsed = submissionsSchema.safeParse(raw);
  if (!parsed.success)
    throw new ProviderError("sec", "unexpected submissions shape", "bad_response");
  const r = parsed.data.filings.recent;
  const want = new Set(forms);
  const out: FilingRef[] = [];
  for (let i = 0; i < r.accessionNumber.length; i++) {
    const form = r.form[i]!;
    if (!want.has(form) || !r.primaryDocument[i]) continue;
    const items = r.items?.[i]?.trim();
    out.push({
      accession: r.accessionNumber[i]!,
      form,
      filingDate: r.filingDate[i]!,
      reportDate: r.reportDate?.[i] || null,
      primaryDocument: r.primaryDocument[i]!,
      description:
        [r.primaryDocDescription?.[i]?.trim(), items ? `items ${items}` : ""]
          .filter(Boolean)
          .join(", ") || null,
      url: archiveUrl(cik, r.accessionNumber[i]!, r.primaryDocument[i]!),
    });
  }
  return out.sort((a, b) => b.filingDate.localeCompare(a.filingDate)).slice(0, limit);
}

export type FilingSection = "business" | "risk_factors" | "mdna" | "all";

/** The MD&A heading, with or without its long tail. A trailing page number (a contents line) does not match. */
const MDNA =
  "management['’]?s\\s+discussion\\s+and\\s+analysis(?:\\s+of\\s+financial\\s+condition\\s+and\\s+results\\s+of\\s+operations)?";
const H = (body: string) => new RegExp(`^item\\s*${body}\\s*\\.?\\s*$`, "gim");
const E = (body: string) => new RegExp(`^item\\s*${body}`, "im");

/** Section headings by form. A 10-Q puts MD&A in Part I Item 2 and risk factors in Part II Item 1A. */
const SECTIONS: Record<string, Partial<Record<FilingSection, [RegExp, RegExp]>>> = {
  "10-K": {
    business: [H("1\\s*[.:-]?\\s*business"), E("1a\\s*[.:-]?\\s*risk\\s+factors")],
    risk_factors: [
      H("1a\\s*[.:-]?\\s*risk\\s+factors"),
      E("(1b|1c|2)\\s*[.:-]?\\s*(unresolved|cybersecurity|properties)"),
    ],
    mdna: [
      H(`7\\s*[.:-]?\\s*${MDNA}`),
      E("(7a|8)\\s*[.:-]?\\s*(quantitative|financial\\s+statements)"),
    ],
  },
  "10-Q": {
    risk_factors: [
      H("1a\\s*[.:-]?\\s*risk\\s+factors"),
      E("(2|5|6)\\s*[.:-]?\\s*(unregistered|other|exhibits)"),
    ],
    mdna: [H(`2\\s*[.:-]?\\s*${MDNA}`), E("(3|4)\\s*[.:-]?\\s*(quantitative|controls)")],
  },
};

/**
 * Plain text of one section of a filing, or the whole document for "all" or when the form's headings are not found.
 * `found` says whether the section heading was located.
 */
export function filingSectionText(
  html: string,
  form: string,
  section: FilingSection,
): { text: string; found: boolean } {
  const text = htmlToText(html);
  if (section === "all") return { text, found: true };
  const rule = SECTIONS[form]?.[section];
  if (rule) {
    const body = longestSection(text, rule[0], rule[1]);
    if (body.split(/\s+/).length >= MIN_SECTION_WORDS) return { text: body, found: true };
  }
  return { text, found: false };
}

export interface FullTextHit {
  company: string;
  ticker: string | null;
  cik: string;
  form: string;
  filingDate: string;
  periodEnding: string | null;
  url: string;
}

const hitsSchema = z.object({
  hits: z.object({
    total: z.object({ value: z.number() }).optional(),
    hits: z.array(
      z.object({
        _id: z.string(),
        _source: z.object({
          ciks: z.array(z.string()),
          display_names: z.array(z.string()),
          form: z.string(),
          file_date: z.string(),
          period_ending: z.string().nullable().optional(),
          adsh: z.string(),
        }),
      }),
    ),
  }),
});

/** Hits from an EDGAR full-text search response: one per document, the first filer named. */
export function parseFullTextHits(
  raw: unknown,
  limit = 10,
): { total: number; hits: FullTextHit[] } {
  const parsed = hitsSchema.safeParse(raw);
  if (!parsed.success)
    throw new ProviderError("sec", "unexpected full-text search shape", "bad_response");
  const seen = new Set<string>();
  const hits: FullTextHit[] = [];
  for (const h of parsed.data.hits.hits) {
    const s = h._source;
    const doc = h._id.split(":")[1];
    const cik = s.ciks[0];
    if (!doc || !cik || seen.has(s.adsh)) continue;
    seen.add(s.adsh);
    const name = s.display_names[0] ?? "";
    // "INTEL CORP  (INTC)  (CIK 0000050863)"
    const m = /^(.*?)\s+\(([A-Z.\-, ]+)\)\s+\(CIK/.exec(name);
    hits.push({
      company: (m?.[1] ?? name.replace(/\s*\(CIK.*$/, "")).trim(),
      ticker: m?.[2]?.split(",")[0]?.trim() ?? null,
      cik,
      form: s.form,
      filingDate: s.file_date,
      periodEnding: s.period_ending ?? null,
      url: archiveUrl(cik, s.adsh, doc),
    });
    if (hits.length >= limit) break;
  }
  return { total: parsed.data.hits.total?.value ?? hits.length, hits };
}
