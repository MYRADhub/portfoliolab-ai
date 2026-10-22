import { cookies } from "next/headers";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import {
  assertEnabled,
  EXPERIMENT_COOKIE,
  requireParticipant,
  withdraw,
} from "@/server/experiment";

/** Withdraws from the study: deletes everything stored about the participant and clears the cookie. */
export const DELETE = route(async () => {
  assertEnabled();
  const p = await requireParticipant(db());
  await withdraw(db(), p.id);
  (await cookies()).delete(EXPERIMENT_COOKIE);
  return Response.json({ withdrawn: true });
});
