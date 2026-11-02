import { z } from "zod";
import { requireSessionId } from "@/server/current-session";
import { db } from "@/server/db";
import { route } from "@/server/errors";
import { addPin, listPins, NOTE_MAX } from "@/server/research-notebook";

const portfolioParam = z.string().uuid().nullable();
const bodySchema = z.object({
  messageId: z.number().int().positive(),
  displayId: z
    .string()
    .regex(/^D\d{1,4}$/)
    .nullable()
    .optional(),
  portfolioId: z.string().uuid().nullable().optional(),
  note: z.string().max(NOTE_MAX).nullable().optional(),
});

/** The pins of a notebook: ?portfolioId=<id> for a portfolio's, none for General. */
export const GET = route(async (req) => {
  const sid = await requireSessionId();
  const portfolioId = portfolioParam.parse(
    new URL(req.url).searchParams.get("portfolioId") || null,
  );
  return Response.json({ pins: await listPins(db(), sid, portfolioId) });
});

export const POST = route(async (req) => {
  const sid = await requireSessionId();
  const body = bodySchema.parse(await req.json());
  const r = await addPin(db(), sid, body);
  return Response.json(r, { status: r.created ? 201 : 200 });
});
