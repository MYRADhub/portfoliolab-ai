import { z } from "zod";
import { requireSessionId } from "@/server/current-session";
import { db } from "@/server/db";
import { route } from "@/server/errors";
import { getNewsAnalysis } from "@/server/news-analysis";

const paramsSchema = z.object({
  id: z.string().uuid(),
  articleId: z.coerce.number().int().positive(),
});

/** How one story was found, linked, classified and scored for this portfolio, and how the stock moved after it. */
export const GET = route<{ id: string; articleId: string }>(async (_req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id, articleId } = paramsSchema.parse(await ctx.params);
  return Response.json(await getNewsAnalysis(db(), sid, id, articleId));
});
