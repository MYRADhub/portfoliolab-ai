import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companies, pricesDaily, sessions } from "@portfolio-lab/db";
import { createTestDb } from "@portfolio-lab/db/testing";
import { AppError } from "./errors";
import { addToWatchlist, getWatchlist, MAX_WATCHED, removeFromWatchlist } from "./watchlist";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let sid: string;
const now = new Date("2024-06-28T00:00:00Z");

function dayString(i: number) {
  return new Date(Date.UTC(2023, 5, 1) + i * 86_400_000).toISOString().slice(0, 10);
}

beforeAll(async () => {
  ctx = await createTestDb();
  [{ id: sid }] = (await ctx.db.insert(sessions).values([{}]).returning()) as { id: string }[];
  await ctx.db.insert(companies).values(
    Array.from({ length: MAX_WATCHED + 2 }, (_, i) => ({
      ticker: `T${String(i).padStart(2, "0")}`,
      name: `Test company ${i}`,
    })),
  );
  // T00 wiggles around 100 for 300 days and then drops 12% on the last day; T01 has only five days of prices.
  const [t0, t1] = await ctx.db.select().from(companies).orderBy(companies.ticker).limit(2);
  const rows = Array.from({ length: 300 }, (_, i) => ({
    companyId: t0!.id,
    date: dayString(i),
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    adjClose: i === 299 ? 88 : 100 + Math.sin(i) * 0.5,
    volume: 1,
  }));
  rows.push(
    ...Array.from({ length: 5 }, (_, i) => ({
      companyId: t1!.id,
      date: dayString(295 + i),
      open: 50,
      high: 50,
      low: 50,
      close: 50,
      adjClose: 50,
      volume: 1,
    })),
  );
  await ctx.db.insert(pricesDaily).values(rows);
});
afterAll(async () => {
  await ctx.teardown();
});

describe("watchlist service", () => {
  it("computes signals and alerts from the company's own prices", async () => {
    await addToWatchlist(ctx.db, sid, "t00");
    const w = await getWatchlist(ctx.db, sid, { now });
    const item = w.items[0]!;
    expect(item.ticker).toBe("T00");
    expect(item.signals!.last).toBe(88);
    expect(item.signals!.d1).toBeCloseTo(88 / (100 + Math.sin(298) * 0.5) - 1, 12);
    expect(item.alerts.map((a) => a.kind)).toContain("big_move");
    expect(item.alerts.map((a) => a.kind)).toContain("near_low");
    expect(w.alerts[0]!.ticker).toBe("T00");
    expect(w.alerts[0]!.alert.severity).toBe(2);
    expect(item.news).toEqual({ count: 0, latest: null });
  });

  it("says a company with too little history has no signals instead of inventing them", async () => {
    await addToWatchlist(ctx.db, sid, "T01");
    const w = await getWatchlist(ctx.db, sid, { now });
    const thin = w.items.find((i) => i.ticker === "T01")!;
    expect(thin.signals).toBeNull();
    expect(thin.alerts).toEqual([]);
  });

  it("adding twice keeps one row, and unknown companies are rejected", async () => {
    await addToWatchlist(ctx.db, sid, "T00");
    expect(
      (await getWatchlist(ctx.db, sid, { now })).items.filter((i) => i.ticker === "T00"),
    ).toHaveLength(1);
    await expect(addToWatchlist(ctx.db, sid, "NOPE")).rejects.toMatchObject({ code: "not_found" });
  });

  it(`holds at most ${MAX_WATCHED} companies`, async () => {
    for (let i = 2; i < MAX_WATCHED; i++)
      await addToWatchlist(ctx.db, sid, `T${String(i).padStart(2, "0")}`);
    expect((await getWatchlist(ctx.db, sid, { now })).items).toHaveLength(MAX_WATCHED);
    const err = await addToWatchlist(ctx.db, sid, `T${MAX_WATCHED}`).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("conflict");
    await addToWatchlist(ctx.db, sid, "T05"); // already listed: no error at the limit
  });

  it("removes one company and leaves the rest", async () => {
    await removeFromWatchlist(ctx.db, sid, "T00");
    await removeFromWatchlist(ctx.db, sid, "T00");
    const tickers = (await getWatchlist(ctx.db, sid, { now })).items.map((i) => i.ticker);
    expect(tickers).not.toContain("T00");
    expect(tickers).toHaveLength(MAX_WATCHED - 1);
  });
});
