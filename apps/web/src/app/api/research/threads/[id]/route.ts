import { z } from "zod";
import { requireSessionId } from "@/server/current-session";
import { db } from "@/server/db";
import { route } from "@/server/errors";
import { deleteThread, getThread } from "@/server/research-chat";

const paramsSchema = z.object({ id: z.string().uuid() });

export const GET = route<{ id: string }>(async (_req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  return Response.json(await getThread(db(), sid, id));
});

export const DELETE = route<{ id: string }>(async (_req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  await deleteThread(db(), sid, id);
  return new Response(null, { status: 204 });
});
