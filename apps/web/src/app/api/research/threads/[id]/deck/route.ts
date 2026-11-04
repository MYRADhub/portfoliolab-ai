import { z } from "zod";
import { createOpenAIDeckGenerator } from "@portfolio-lab/explain";
import { aiLimiterFor } from "@/server/ai-guard";
import { requireSessionId } from "@/server/current-session";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { AppError, route } from "@/server/errors";
import { getDeck, makeDeck } from "@/server/research-deck";

const paramsSchema = z.object({ id: z.string().uuid() });

export const GET = route<{ id: string }>(async (_req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  return Response.json({ deck: await getDeck(db(), sid, id) });
});

/** Makes the presentation for a conversation, replacing any earlier one. */
export const POST = route<{ id: string }>(async (req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  const key = env().OPENAI_API_KEY;
  if (!key) throw new AppError("unavailable", "Presentations are not configured on this server");
  return Response.json({
    deck: await makeDeck(db(), sid, id, createOpenAIDeckGenerator(key), {
      limiter: aiLimiterFor(req, "deck"),
    }),
  });
});
