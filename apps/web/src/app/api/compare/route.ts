import { z } from "zod";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import { requireSessionId } from "@/server/current-session";
import { comparePortfolios } from "@/server/compare";

const querySchema = z.object({ a: z.string().uuid(), b: z.string().uuid() });

export const GET = route(async (req) => {
  const sid = await requireSessionId();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await comparePortfolios(db(), sid, q.a, q.b));
});
