import { z } from "zod";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import { eligibleBellwethers, getPooledSpilloverCached, getSpillover } from "@/server/spillover";

const querySchema = z.object({
  ticker: z
    .string()
    .regex(/^[A-Za-z.\-]{1,10}$/)
    .optional(),
  events: z.coerce.number().int().min(1).max(24).optional(),
  pooled: z.enum(["1"]).optional(),
});

export const GET = route(async (req) => {
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  if (q.pooled) return Response.json(await getPooledSpilloverCached(db(), q.events));
  if (!q.ticker) return Response.json({ eligible: await eligibleBellwethers(db()) });
  return Response.json(await getSpillover(db(), q.ticker, { events: q.events }));
});
