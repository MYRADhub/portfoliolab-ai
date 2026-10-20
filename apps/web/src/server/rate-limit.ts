import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { rateLimitHits, type Db } from "@portfolio-lab/db";

/**
 * Sliding-window limiter stored in Postgres so limits hold across server instances. Each key is serialized with a
 * transaction-scoped advisory lock, so concurrent requests cannot both slip under the limit.
 */
export class RateLimiter {
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
