import { cookies } from "next/headers";
import { route, AppError } from "@/server/errors";
import { db } from "@/server/db";
import {
  assertEnabled,
  enroll,
  enrollSchema,
  EXPERIMENT_COOKIE,
  requireParticipant,
  signParticipantId,
} from "@/server/experiment";

const MAX_AGE = 60 * 60 * 24 * 30;

export const POST = route(async (req) => {
  assertEnabled();
  const input = enrollSchema.parse(await req.json());
  try {
    const existing = await requireParticipant(db());
    return Response.json({ participant: { arm: existing.arm, completed: existing.completed } });
  } catch (e) {
    if (!(e instanceof AppError && e.code === "unauthorized")) throw e;
  }
  const p = await enroll(db(), input);
  (await cookies()).set(EXPERIMENT_COOKIE, signParticipantId(p.id), {
    httpOnly: true,
    sameSite: "lax",
    secure:
      new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: MAX_AGE,
  });
  return Response.json({ participant: { arm: p.arm, completed: false } }, { status: 201 });
});
