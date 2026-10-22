import { route } from "@/server/errors";
import { db } from "@/server/db";
import { assertEnabled, getUniverse, logEvent, requireParticipant } from "@/server/experiment";

export const GET = route(async () => {
  assertEnabled();
  const p = await requireParticipant(db());
  await logEvent(db(), p.id, "universe_loaded");
  return Response.json({ arm: p.arm, companies: await getUniverse(db(), p.arm) });
});
