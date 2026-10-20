import { cookies } from "next/headers";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import { resolveSession, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/server/session";

export const POST = route(async (req) => {
  const store = await cookies();
  const session = await resolveSession(db(), store.get(SESSION_COOKIE)?.value);
  if (session.created) {
    store.set(SESSION_COOKIE, session.id, {
      httpOnly: true,
      sameSite: "lax",
      // Secure only when the request actually arrived over https, so a plain-http deployment keeps working.
      secure:
        new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
  }
  return Response.json({ created: session.created });
});
