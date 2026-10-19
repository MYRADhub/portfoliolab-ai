import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { sessions } from "@portfolio-lab/db";
import { AppError } from "./errors";
import { db } from "./db";
import { SESSION_COOKIE } from "./session";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns the id of the existing anonymous session or throws 401. Never creates one. */
export async function requireSessionId(): Promise<string> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (value && UUID_RE.test(value)) {
    const [row] = await db()
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, value));
    if (row) return row.id;
  }
  throw new AppError("unauthorized", "No active session");
}
