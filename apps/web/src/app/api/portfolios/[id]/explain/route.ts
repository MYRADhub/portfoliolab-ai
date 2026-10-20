import { z } from "zod";
import { createOpenAIExplainer } from "@portfolio-lab/explain";
import { route, AppError } from "@/server/errors";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireSessionId } from "@/server/current-session";
import { getExplanation } from "@/server/explain";

const paramsSchema = z.object({ id: z.string().uuid() });

export const POST = route<{ id: string }>(async (_req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  const apiKey = env().OPENAI_API_KEY;
  if (!apiKey) throw new AppError("unavailable", "Explanations are not configured on this server");
  const generator = createOpenAIExplainer(apiKey);
  return Response.json(await getExplanation(db(), sid, id, generator));
});
