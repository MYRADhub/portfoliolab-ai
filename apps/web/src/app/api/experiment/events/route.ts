import { experimentEvents } from "@portfolio-lab/db";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import { assertEnabled, eventsSchema, requireParticipant } from "@/server/experiment";

export const POST = route(async (req) => {
  assertEnabled();
  const p = await requireParticipant(db());
  const { events } = eventsSchema.parse(await req.json());
  await db()
    .insert(experimentEvents)
    .values(events.map((e) => ({ participantId: p.id, type: e.type, payload: e.payload ?? null })));
  return Response.json({ logged: events.length }, { status: 201 });
});
