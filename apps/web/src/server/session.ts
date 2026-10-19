import { eq } from "drizzle-orm";
import { sessions, type Db } from "@portfolio-lab/db";

export const SESSION_COOKIE = "pl_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResolvedSession {
  id: string;
  /** True when a new session row was created and the cookie must be (re)set. */
  created: boolean;
}

/** Resolves the anonymous session from a cookie value, creating one if absent, malformed, or unknown. */
export async function resolveSession(
  db: Db,
  cookieValue: string | undefined,
): Promise<ResolvedSession> {
  if (cookieValue && UUID_RE.test(cookieValue)) {
    const updated = await db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, cookieValue))
      .returning({ id: sessions.id });
    if (updated[0]) return { id: updated[0].id, created: false };
  }
  const [row] = await db.insert(sessions).values({}).returning({ id: sessions.id });
  if (!row) throw new Error("failed to create session");
  return { id: row.id, created: true };
}
