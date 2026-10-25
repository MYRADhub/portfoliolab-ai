import { and, eq, inArray, max, sql } from "drizzle-orm";
import { companies, pricesDaily, type Db } from "@portfolio-lab/db";
import { z } from "zod";
import type { ImportKind } from "@/lib/import-holdings";
import { AppError } from "./errors";

export const MAX_IMPORT_HOLDINGS = 50;
export const MIN_HISTORY_DAYS = 30;

export const previewSchema = z.object({
  kind: z.enum(["weights", "values", "shares"]),
  holdings: z
    .array(
      z.object({
        ticker: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z][A-Z0-9]{0,5}(\.[A-Z])?$/),
        amount: z.number().positive().finite(),
      }),
    )
    .min(1)
    .max(500),
});

export interface ImportPreview {
  kind: ImportKind;
  holdings: {
    ticker: string;
    name: string;
    sector: string | null;
    /** Share of the importable total, in percent. */
    weightPct: number;
    /** Latest close used to turn share counts into money; null unless the numbers were share counts. */
    price: number | null;
    /** Fewer than MIN_HISTORY_DAYS of prices: analyses will not run until more history is loaded. */
    thinHistory: boolean;
  }[];
  /** Tickers that are not in the S&P 500 universe. */
  unknown: string[];
  /** Share counts that could not be priced, so were left out. */
  noPrice: string[];
}

/**
 * Turns parsed holdings into portfolio weights. Percentages are rescaled to 100, dollar values are divided by their total,
 * and share counts are multiplied by the latest close. Tickers we do not cover are listed and left out.
 */
export async function previewImport(
  db: Db,
  input: z.infer<typeof previewSchema>,
): Promise<ImportPreview> {
  const known = await db
    .select({
      id: companies.id,
      ticker: companies.ticker,
      name: companies.name,
      sector: companies.sector,
    })
    .from(companies)
    .where(
      inArray(
        companies.ticker,
        input.holdings.map((h) => h.ticker),
      ),
    );
  const byTicker = new Map(known.map((c) => [c.ticker, c]));
  const unknown = input.holdings.filter((h) => !byTicker.has(h.ticker)).map((h) => h.ticker);
  const usable = input.holdings.filter((h) => byTicker.has(h.ticker));
  if (usable.length > MAX_IMPORT_HOLDINGS)
    throw new AppError(
      "bad_request",
      `A portfolio can hold up to ${MAX_IMPORT_HOLDINGS} companies; this has ${usable.length}`,
    );

  const ids = usable.map((h) => byTicker.get(h.ticker)!.id);
  const stats = ids.length
    ? await db
        .select({
          id: pricesDaily.companyId,
          days: sql<number>`count(*)::int`,
          last: max(pricesDaily.date),
        })
        .from(pricesDaily)
        .where(inArray(pricesDaily.companyId, ids))
        .groupBy(pricesDaily.companyId)
    : [];
  const days = new Map(stats.map((s) => [s.id, s.days]));
  const lastDate = new Map(stats.map((s) => [s.id, s.last]));

  const price = new Map<number, number>();
  if (input.kind === "shares" && ids.length) {
    for (const id of ids) {
      const d = lastDate.get(id);
      if (!d) continue;
      const [row] = await db
        .select({ close: pricesDaily.adjClose })
        .from(pricesDaily)
        .where(and(eq(pricesDaily.companyId, id), eq(pricesDaily.date, d)));
      if (row) price.set(id, row.close);
    }
  }

  const noPrice: string[] = [];
  const amounts = usable.flatMap((h) => {
    const c = byTicker.get(h.ticker)!;
    if (input.kind !== "shares") return [{ c, amount: h.amount, price: null as number | null }];
    const p = price.get(c.id);
    if (p === undefined) {
      noPrice.push(h.ticker);
      return [];
    }
    return [{ c, amount: h.amount * p, price: p }];
  });
  const total = amounts.reduce((a, x) => a + x.amount, 0);
  return {
    kind: input.kind,
    holdings: amounts.map((x) => ({
      ticker: x.c.ticker,
      name: x.c.name,
      sector: x.c.sector,
      weightPct: total > 0 ? Math.round((x.amount / total) * 1_000_000) / 10_000 : 0,
      price: x.price,
      thinHistory: (days.get(x.c.id) ?? 0) < MIN_HISTORY_DAYS,
    })),
    unknown,
    noPrice,
  };
}
