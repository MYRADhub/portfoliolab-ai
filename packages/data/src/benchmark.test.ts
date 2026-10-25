import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { benchmarkPrices } from "@portfolio-lab/db";
import { createTestDb } from "@portfolio-lab/db/testing";
import { FixtureProvider, ingestBenchmark } from "./index";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  ctx = await createTestDb();
});
afterAll(async () => {
  await ctx.teardown();
});

describe("ingestBenchmark", () => {
  it("stores one adjusted close per trading day and resumes after the latest stored day", async () => {
    const provider = new FixtureProvider();
    const first = await ingestBenchmark(ctx.db, provider, "SPY", {
      backfillFrom: "2024-01-01",
      to: "2024-01-31",
    });
    expect(first.inserted).toBe(23); // January 2024 has 23 weekdays
    const again = await ingestBenchmark(ctx.db, provider, "SPY", {
      backfillFrom: "2024-01-01",
      to: "2024-01-31",
    });
    expect(again.inserted).toBe(0);
    const more = await ingestBenchmark(ctx.db, provider, "SPY", {
      backfillFrom: "2024-01-01",
      to: "2024-02-09",
    });
    expect(more.inserted).toBe(7); // 1 to 9 February are 7 weekdays
    const rows = await ctx.db
      .select()
      .from(benchmarkPrices)
      .where(eq(benchmarkPrices.symbol, "SPY"));
    expect(rows).toHaveLength(30);
    expect(new Set(rows.map((r) => r.date)).size).toBe(30);
  });

  it("keeps symbols apart", async () => {
    const provider = new FixtureProvider();
    await ingestBenchmark(ctx.db, provider, "QQQ", {
      backfillFrom: "2024-03-01",
      to: "2024-03-08",
    });
    const spy = await ctx.db
      .select()
      .from(benchmarkPrices)
      .where(eq(benchmarkPrices.symbol, "SPY"));
    const qqq = await ctx.db
      .select()
      .from(benchmarkPrices)
      .where(eq(benchmarkPrices.symbol, "QQQ"));
    expect(qqq).toHaveLength(6);
    expect(spy).toHaveLength(30);
  });

  it("does nothing when asked for a range that is already past", async () => {
    const provider = new FixtureProvider();
    const r = await ingestBenchmark(ctx.db, provider, "SPY", {
      backfillFrom: "2023-01-01",
      to: "2023-01-05",
    });
    expect(r.inserted).toBe(0);
  });
});
