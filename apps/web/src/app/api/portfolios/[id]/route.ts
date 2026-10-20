import { z } from "zod";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import { requireSessionId } from "@/server/current-session";
import { deletePortfolio } from "@/server/portfolios";

const paramsSchema = z.object({ id: z.string().uuid() });

export const DELETE = route<{ id: string }>(async (_req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  await deletePortfolio(db(), sid, id);
  return new Response(null, { status: 204 });
});
