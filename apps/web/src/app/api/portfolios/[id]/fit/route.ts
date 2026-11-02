import { z } from "zod";
import { requireSessionId } from "@/server/current-session";
import { db } from "@/server/db";
import { route } from "@/server/errors";
import { DEFAULT_FIT_WEIGHT, getPortfolioFit } from "@/server/portfolio-fit";
import { fitDisplays } from "@/server/portfolio-tools";

const paramsSchema = z.object({ id: z.string().uuid() });
const querySchema = z.object({
  ticker: z.string().regex(/^[A-Za-z.\-]{1,10}$/),
  weight: z.coerce.number().gt(0).max(0.5).default(DEFAULT_FIT_WEIGHT),
});

/** How a company would fit the portfolio: the full analysis and the charts the assistant would offer. */
export const GET = route<{ id: string }>(async (req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const fit = await getPortfolioFit(db(), sid, id, q.ticker, q.weight);
  return Response.json({
    fit,
    displays: fitDisplays(fit).map((d, i) => ({ ...d, id: `D${i + 1}` })),
  });
});
