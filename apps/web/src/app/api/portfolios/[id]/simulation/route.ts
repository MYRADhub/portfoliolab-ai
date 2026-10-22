import { z } from "zod";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import { requireSessionId } from "@/server/current-session";
import { getSimulation } from "@/server/simulation";

const paramsSchema = z.object({ id: z.string().uuid() });
const querySchema = z.object({
  years: z.coerce
    .number()
    .refine((y) => [1, 3, 5].includes(y), "years must be 1, 3 or 5")
    .optional(),
  paths: z.coerce.number().int().min(200).max(5000).optional(),
  drift: z.union([z.literal("historical"), z.coerce.number().min(-0.2).max(0.3)]).optional(),
});

export const GET = route<{ id: string }>(async (req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await getSimulation(db(), sid, id, q));
});
