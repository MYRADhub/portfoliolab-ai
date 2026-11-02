import { z } from "zod";
import { requireSessionId } from "@/server/current-session";
import { db } from "@/server/db";
import { route } from "@/server/errors";
import { deletePin, NOTE_MAX, updatePinNote } from "@/server/research-notebook";

const paramsSchema = z.object({ pinId: z.coerce.number().int().positive() });
const patchSchema = z.object({ note: z.string().max(NOTE_MAX).nullable() });

export const PATCH = route<{ pinId: string }>(async (req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { pinId } = paramsSchema.parse(await ctx.params);
  const { note } = patchSchema.parse(await req.json());
  await updatePinNote(db(), sid, pinId, note);
  return new Response(null, { status: 204 });
});

export const DELETE = route<{ pinId: string }>(async (_req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { pinId } = paramsSchema.parse(await ctx.params);
  await deletePin(db(), sid, pinId);
  return new Response(null, { status: 204 });
});
