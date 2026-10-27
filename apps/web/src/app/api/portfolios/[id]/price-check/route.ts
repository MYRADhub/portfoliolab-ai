import { z } from "zod";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import { requireSessionId } from "@/server/current-session";
import { getPortfolioPriceCheck } from "@/server/price-check";

const paramsSchema = z.object({ id: z.string().uuid() });

export const GET = route<{ id: string }>(async (_req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  return Response.json(await getPortfolioPriceCheck(db(), sid, id));
});
