import { z } from "zod";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import { requireSessionId } from "@/server/current-session";
import { getStressCatalog, runStress } from "@/server/stress";

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z
  .object({
    preset: z.string().max(40).optional(),
    shocks: z.record(z.string().max(60), z.number().min(-1).max(1)).optional(),
  })
  .refine((b) => b.preset || b.shocks, "Provide a preset or shocks");

export const GET = route<{ id: string }>(async (_req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  return Response.json(await getStressCatalog(db(), sid, id));
});

export const POST = route<{ id: string }>(async (req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  const body = bodySchema.parse(await req.json());
  return Response.json(await runStress(db(), sid, id, body));
});
