import { route } from "@/server/errors";
import { db } from "@/server/db";
import { assertEnabled, requireParticipant, submit, submitSchema } from "@/server/experiment";

export const POST = route(async (req) => {
  assertEnabled();
  const p = await requireParticipant(db());
  await submit(db(), p, submitSchema.parse(await req.json()));
  return Response.json({ submitted: true }, { status: 201 });
});
