import { z } from "zod";
import { createOpenAIExplainer } from "@portfolio-lab/explain";
import { route, AppError } from "@/server/errors";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireSessionId } from "@/server/current-session";
import { getMoveExplanation } from "@/server/explain";

const paramsSchema = z.object({ id: z.string().uuid() });
const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const POST = route<{ id: string }>(async (req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  const { date } = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const apiKey = env().OPENAI_API_KEY;
  if (!apiKey) throw new AppError("unavailable", "Explanations are not configured on this server");
  return Response.json(
    await getMoveExplanation(db(), sid, id, createOpenAIExplainer(apiKey), { date }),
  );
});
