import { z } from "zod";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import { requireSessionId } from "@/server/current-session";
import { getPortfolioAnalytics } from "@/server/portfolios";

const paramsSchema = z.object({ id: z.string().uuid() });
const querySchema = z.object({ years: z.coerce.number().int().min(1).max(5).default(1) });

export const GET = route<{ id: string }>(async (req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  const { years } = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await getPortfolioAnalytics(db(), sid, id, { years }));
});
