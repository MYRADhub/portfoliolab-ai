import { z } from "zod";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import { requireSessionId } from "@/server/current-session";
import { getDiscovery } from "@/server/discovery";

const paramsSchema = z.object({ id: z.string().uuid() });
const querySchema = z.object({
  weight: z.coerce.number().min(0.01).max(0.5).optional(),
  limit: z.coerce.number().int().min(1).max(25).optional(),
  sector: z.string().max(60).optional(),
});

export const GET = route<{ id: string }>(async (req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await getDiscovery(db(), sid, id, q));
});
