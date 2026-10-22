import { z } from "zod";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import { requireSessionId } from "@/server/current-session";
import { getRebalance } from "@/server/rebalance";

const paramsSchema = z.object({ id: z.string().uuid() });
const querySchema = z.object({ maxWeight: z.coerce.number().min(0.05).max(1).optional() });

export const GET = route<{ id: string }>(async (req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await getRebalance(db(), sid, id, q));
});
