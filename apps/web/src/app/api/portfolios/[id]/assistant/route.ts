import { z } from "zod";
import { createOpenAIAssistantModel } from "@portfolio-lab/explain";
import { route, AppError } from "@/server/errors";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireSessionId } from "@/server/current-session";
import { askAssistant, HISTORY_ANSWER_MAX, HISTORY_TURNS, QUESTION_MAX } from "@/server/assistant";

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
  question: z.string().max(QUESTION_MAX + 200),
  history: z
    .array(
      z.object({
        question: z.string().max(QUESTION_MAX),
        answer: z.string().max(HISTORY_ANSWER_MAX),
      }),
    )
    .max(HISTORY_TURNS)
    .optional(),
});

export const POST = route<{ id: string }>(async (req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  const { question, history } = bodySchema.parse(await req.json());
  const apiKey = env().OPENAI_API_KEY;
  if (!apiKey) throw new AppError("unavailable", "The assistant is not configured on this server");
  return Response.json(
    await askAssistant(db(), sid, id, question, createOpenAIAssistantModel(apiKey), { history }),
  );
});
