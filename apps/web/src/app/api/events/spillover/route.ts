import { z } from "zod";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import { eligibleBellwethers, getPooledSpillover, getSpillover } from "@/server/spillover";

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
  if (q.pooled) return Response.json(await pooled(q.events));
  if (!q.ticker) return Response.json({ eligible: await eligibleBellwethers(db()) });
  return Response.json(await getSpillover(db(), q.ticker, { events: q.events }));
});

let cache: { key: string; at: number; value: unknown } | null = null;
const CACHE_MS = 10 * 60_000;

/** The pooled test reads every bellwether's earnings days, so one result is shared for a few minutes. */
async function pooled(events: number | undefined) {
  const key = String(events ?? "");
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.value;
  const value = await getPooledSpillover(db(), { events });
  cache = { key, at: Date.now(), value };
  return value;
}
