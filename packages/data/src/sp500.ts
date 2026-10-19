import { sql } from "drizzle-orm";
import { companies, type Db } from "@portfolio-lab/db";

export interface Constituent {
  ticker: string;
  name: string;
  sector: string;
  industry: string;
  dateAdded: string | null;
  cik: string | null;
}

function cleanCell(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/g, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "")
    .replace(/\{\{[^}|]*\|([^}|]*)(\|[^}]*)?\}\}/g, "$1")
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
    .replace(/'''?/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\|+\s*$/, "")
    .trim();
}

/** Parses the constituents table from the raw wikitext of Wikipedia's "List of S&P 500 companies". */
export function parseSp500Wikitext(wikitext: string): Constituent[] {
  const start = wikitext.indexOf('id="constituents"');
  if (start === -1) throw new Error("constituents table not found");
  const end = wikitext.indexOf("\n|}", start);
  const table = wikitext.slice(start, end === -1 ? undefined : end);
  const rows = table.split(/\n\|-\s*/).slice(1);

  const out: Constituent[] = [];
  for (const row of rows) {
    if (row.trimStart().startsWith("!")) continue;
    // Cells start with "|" or "||" on their own line, but some rows pack several cells on one line.
    const cells = row
      .split("\n")
      .filter((l) => l.startsWith("|"))
      .flatMap((l) => l.replace(/^\|\|?/, "").split("||"))
      .map(cleanCell);
    if (cells.length < 4) continue;
    const [ticker, name, sector, industry, , dateAdded, cik] = cells;
    if (!ticker || !name || !sector || !industry) continue;
    out.push({
      ticker: ticker.toUpperCase(),
      name,
      sector,
      industry,
      dateAdded: dateAdded && /^\d{4}-\d{2}-\d{2}$/.test(dateAdded) ? dateAdded : null,
      cik: cik ? cik.replace(/\D/g, "").padStart(10, "0") : null,
    });
  }
  return out;
}

/** Upserts constituents by ticker. Does not delete companies that have left the index. */
export async function loadConstituents(db: Db, items: readonly Constituent[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < items.length; i += 200) {
    const chunk = items.slice(i, i + 200).map((c) => ({
      ticker: c.ticker,
      name: c.name,
      sector: c.sector,
      industry: c.industry,
    }));
    const rows = await db
      .insert(companies)
      .values(chunk)
      .onConflictDoUpdate({
        target: companies.ticker,
        set: {
          name: sql`excluded.name`,
          sector: sql`excluded.sector`,
          industry: sql`excluded.industry`,
        },
      })
      .returning({ id: companies.id });
    n += rows.length;
  }
  return n;
}
