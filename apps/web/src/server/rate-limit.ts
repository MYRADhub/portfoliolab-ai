import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { rateLimitHits, type Db } from "@portfolio-lab/db";

/** Anything that can admit or refuse one attempt for a key; the server functions take one for their allowance. */
export interface Limiter {
  tryAcquire(key: string): Promise<boolean>;
}

export interface LimitCheck {
  key: string;
  max: number;
  windowMs: number;
}

/**
 * Checks several sliding-window limits at once and records an attempt against all of them only if every one has
 * room. Returns the index of the first limit that is full, or null when the attempt was recorded. Keys are locked
 * in a fixed order so concurrent callers cannot deadlock.
 */
export async function tryAcquireAll(
  db: Db,
  checks: readonly LimitCheck[],
  now: Date = new Date(),
): Promise<number | null> {
  return db.transaction(async (tx) => {
    for (const key of [...new Set(checks.map((c) => c.key))].sort())
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    for (const [i, c] of checks.entries()) {
      const since = new Date(now.getTime() - c.windowMs);
      await tx
        .delete(rateLimitHits)
        .where(and(eq(rateLimitHits.key, c.key), lt(rateLimitHits.at, since)));
      const [row] = await tx
        .select({ n: count() })
        .from(rateLimitHits)
        .where(and(eq(rateLimitHits.key, c.key), gte(rateLimitHits.at, since)));
      if ((row?.n ?? 0) >= c.max) return i;
    }
    await tx.insert(rateLimitHits).values(checks.map((c) => ({ key: c.key, at: now })));
    return null;
  });
}

/**
 * Sliding-window limiter stored in Postgres so limits hold across server instances. Each key is serialized with a
 * transaction-scoped advisory lock, so concurrent requests cannot both slip under the limit.
 */
export class RateLimiter implements Limiter {
  constructor(
    private readonly db: Db,
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Records an attempt and returns true if it is allowed. Rejected attempts are not recorded. */
  async tryAcquire(key: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
      const t = this.now();
      const since = new Date(t.getTime() - this.windowMs);
      await tx
        .delete(rateLimitHits)
        .where(and(eq(rateLimitHits.key, key), lt(rateLimitHits.at, since)));
      const [row] = await tx
        .select({ n: count() })
        .from(rateLimitHits)
        .where(and(eq(rateLimitHits.key, key), gte(rateLimitHits.at, since)));
      if ((row?.n ?? 0) >= this.max) return false;
      await tx.insert(rateLimitHits).values({ key, at: t });
      return true;
    });
  }
}
