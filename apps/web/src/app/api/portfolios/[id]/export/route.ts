import { z } from "zod";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import { requireSessionId } from "@/server/current-session";
import { toCsv } from "@/server/csv";
import { getTerminal } from "@/server/terminal";

const paramsSchema = z.object({ id: z.string().uuid() });

/** Holdings with weights, latest price, recent returns and share of portfolio risk, as a CSV download. */
export const GET = route<{ id: string }>(async (_req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  const t = await getTerminal(db(), sid, id);
  const rows = t.holdings.map((h) => ({
    ticker: h.ticker,
    name: h.name,
    sector: h.sector,
    weight: h.weight,
    price: h.price,
    return_1d: h.d1,
    return_5d: h.d5,
    return_1m: h.m1,
    share_of_risk: h.riskShare,
    as_of: t.asOf,
  }));
  const name = t.portfolio.name.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40) || "portfolio";
  return new Response(toCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}-holdings.csv"`,
    },
  });
});
