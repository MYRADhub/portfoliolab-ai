import { z } from "zod";
import { route, AppError } from "@/server/errors";
import { db } from "@/server/db";
import { requireSessionId } from "@/server/current-session";
import { addToWatchlist, getWatchlist } from "@/server/watchlist";

const bodySchema = z.object({
  ticker: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z.\-]{1,10}$/),
});

export const GET = route(async () => {
  const sid = await requireSessionId();
  return Response.json(await getWatchlist(db(), sid));
});

export const POST = route(async (req) => {
  const sid = await requireSessionId();
  const body: unknown = await req.json().catch(() => {
    throw new AppError("bad_request", "Body must be valid JSON");
  });
  await addToWatchlist(db(), sid, bodySchema.parse(body).ticker);
  return Response.json(await getWatchlist(db(), sid), { status: 201 });
});
