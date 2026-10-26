import { z } from "zod";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import { requireSessionId } from "@/server/current-session";
import { removeFromWatchlist } from "@/server/watchlist";

const paramsSchema = z.object({
  ticker: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z.\-]{1,10}$/),
});

export const DELETE = route<{ ticker: string }>(async (_req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { ticker } = paramsSchema.parse(await ctx.params);
  await removeFromWatchlist(db(), sid, ticker);
  return new Response(null, { status: 204 });
});
