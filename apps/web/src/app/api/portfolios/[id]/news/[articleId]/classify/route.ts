import { z } from "zod";
import { createOpenAIClassifier } from "@portfolio-lab/classify";
import { aiLimiterFor } from "@/server/ai-guard";
import { requireSessionId } from "@/server/current-session";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { route } from "@/server/errors";
import { classifyNewsStory } from "@/server/news-scan";

const paramsSchema = z.object({
  id: z.string().uuid(),
  articleId: z.coerce.number().int().positive(),
});

/** Classifies a story the scan left unclassified, and returns its refreshed analysis. */
export const POST = route<{ id: string; articleId: string }>(async (req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id, articleId } = paramsSchema.parse(await ctx.params);
  const key = env().OPENAI_API_KEY;
  return Response.json(
    await classifyNewsStory(db(), sid, id, articleId, key ? createOpenAIClassifier(key) : null, {
      limiter: aiLimiterFor(req, "news_classify"),
    }),
  );
});
