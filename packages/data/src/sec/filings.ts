import { z } from "zod";
import { ProviderError } from "../providers/types";

const recentSchema = z.object({
  accessionNumber: z.array(z.string()),
  filingDate: z.array(z.string()),
  acceptanceDateTime: z.array(z.string()),
  form: z.array(z.string()),
  items: z.array(z.string()),
  primaryDocument: z.array(z.string()),
});

const submissionsSchema = z.object({
  cik: z.union([z.string(), z.number()]),
  filings: z.object({ recent: recentSchema }),
});

export interface Filing {
  accession: string;
  /** The moment EDGAR accepted the filing, as an ISO timestamp in UTC: when the market could first see it. */
  acceptedAt: Date;
  filingDate: string;
  form: string;
  items: string[];
  primaryDocument: string;
}

/** Form 8-K filings (and 8-K/A amendments are excluded) from an EDGAR submissions response, newest first. */
export function parseEightKs(raw: unknown, since: string): Filing[] {
  const parsed = submissionsSchema.safeParse(raw);
  if (!parsed.success)
    throw new ProviderError("sec", "unexpected submissions shape", "bad_response");
  const r = parsed.data.filings.recent;
  const out: Filing[] = [];
  for (let i = 0; i < r.accessionNumber.length; i++) {
    if (r.form[i] !== "8-K") continue;
    const filingDate = r.filingDate[i]!;
    if (filingDate < since) continue;
    const acceptedAt = new Date(r.acceptanceDateTime[i]!);
    if (Number.isNaN(acceptedAt.getTime())) continue;
    out.push({
      accession: r.accessionNumber[i]!,
      acceptedAt,
      filingDate,
      form: "8-K",
      items: (r.items[i] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      primaryDocument: r.primaryDocument[i] ?? "",
    });
  }
  return out.sort((a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime());
}

export function filingUrl(cik: string, f: Filing): string {
  const noZeros = String(Number(cik));
  return `https://www.sec.gov/Archives/edgar/data/${noZeros}/${f.accession.replace(/-/g, "")}/${f.primaryDocument}`;
}
