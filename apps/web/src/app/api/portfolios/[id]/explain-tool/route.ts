import { z } from "zod";
import { createOpenAIExplainer } from "@portfolio-lab/explain";
import { route, AppError } from "@/server/errors";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireSessionId } from "@/server/current-session";
import { explainTool } from "@/server/tool-explain";

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.discriminatedUnion("tool", [
  z.object({
    tool: z.literal("stress"),
    preset: z.string().max(40).optional(),
    shocks: z.record(z.string().max(60), z.number().min(-1).max(1)).optional(),
  }),
  z.object({ tool: z.literal("benchmark") }),
  z.object({ tool: z.literal("rebalance"), maxWeight: z.number().min(0.05).max(1).optional() }),
  z.object({
    tool: z.literal("simulation"),
    years: z
      .number()
      .refine((y) => [1, 3, 5].includes(y))
      .optional(),
    drift: z.union([z.literal("historical"), z.number().min(-0.2).max(0.3)]).optional(),
  }),
]);

export const POST = route<{ id: string }>(async (req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  const body = bodySchema.parse(await req.json());
  const apiKey = env().OPENAI_API_KEY;
  if (!apiKey) throw new AppError("unavailable", "Explanations are not configured on this server");
  return Response.json(await explainTool(db(), sid, id, body, createOpenAIExplainer(apiKey)));
});
