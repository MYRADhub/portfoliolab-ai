import { z } from "zod";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import { requireSessionId } from "@/server/current-session";
import { getPortfolioMove } from "@/server/move";

const paramsSchema = z.object({ id: z.string().uuid() });
const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const GET = route<{ id: string }>(async (req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  const { date } = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await getPortfolioMove(db(), sid, id, { date }));
});
