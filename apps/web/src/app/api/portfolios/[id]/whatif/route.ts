import { z } from "zod";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import { requireSessionId } from "@/server/current-session";
import { whatIfAdd } from "@/server/research";

const paramsSchema = z.object({ id: z.string().uuid() });
const querySchema = z.object({
  ticker: z.string().regex(/^[A-Za-z.\-]{1,10}$/),
  weight: z.coerce.number().min(0.01).max(0.5).default(0.05),
});

export const GET = route<{ id: string }>(async (req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await whatIfAdd(db(), sid, id, q.ticker, q.weight));
});
