import { z } from "zod";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import { requireSessionId } from "@/server/current-session";
import { CLASS_FILTERS, getMarketRadar } from "@/server/radar";

const paramsSchema = z.object({ id: z.string().uuid() });
const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(30).default(7),
  class: z.enum(CLASS_FILTERS).optional(),
  ticker: z
    .string()
    .regex(/^[A-Z.\-]{1,10}$/)
    .optional(),
});

export const GET = route<{ id: string }>(async (req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await getMarketRadar(db(), sid, id, query));
});
