import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { companies, pricesDaily } from "@portfolio-lab/db";
import { createTestDb } from "@portfolio-lab/db/testing";
import { seedDevCompanies } from "../../db/src/seed/companies";
import {
  FixtureProvider,
  TiingoProvider,
  ProviderError,
  fetchJson,
  findPriceGaps,
  ingestPrices,
} from "./index";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  ctx = await createTestDb();
  await seedDevCompanies(ctx.db);
});
afterAll(async () => {
  await ctx.teardown();
});

const resp = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe("fetchJson", () => {
  it("retries 429 then succeeds, honoring Retry-After", async () => {
    const calls: number[] = [];
    const sleeps: number[] = [];
    const fetchImpl = (async () => {
      calls.push(1);
      return calls.length === 1 ? resp({}, 429, { "retry-after": "2" }) : resp({ ok: 1 });
    }) as typeof fetch;
    const out = await fetchJson("http://x", {
      provider: "t",
      fetchImpl,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(out).toEqual({ ok: 1 });
    expect(sleeps).toEqual([2000]);
  });

  it("gives up after retries with a rate_limited error", async () => {
    const fetchImpl = (async () => resp({}, 429)) as typeof fetch;
    await expect(
      fetchJson("http://x", { provider: "t", fetchImpl, retries: 2, sleep: async () => undefined }),
    ).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("maps 404 without retrying", async () => {
    let n = 0;
    const fetchImpl = (async () => (n++, resp({}, 404))) as typeof fetch;
    await expect(fetchJson("http://x", { provider: "t", fetchImpl })).rejects.toMatchObject({
      kind: "not_found",
    });
    expect(n).toBe(1);
  });
});

describe("TiingoProvider", () => {
  it("parses and sorts rows, trimming the timestamp to a date", async () => {
    const fetchImpl = (async () =>
      resp([
        {
          date: "2024-01-03T00:00:00.000Z",
          close: 11,
          adjClose: 5.5,
          open: 10,
          high: 12,
          low: 9,
          volume: 100,
        },
        { date: "2024-01-02T00:00:00.000Z", close: 10, adjClose: 5, volume: null },
      ])) as typeof fetch;
    const bars = await new TiingoProvider("k", { fetchImpl }).getDailyBars(
      "NVDA",
      "2024-01-01",
      "2024-01-31",
    );
    expect(bars.map((b) => b.date)).toEqual(["2024-01-02", "2024-01-03"]);
    expect(bars[0]).toMatchObject({ adjClose: 5, open: null, volume: null });
  });

  it("rejects an unexpected shape", async () => {
    const fetchImpl = (async () => resp({ detail: "Error" })) as typeof fetch;
    await expect(
      new TiingoProvider("k", { fetchImpl }).getDailyBars("X", "2024-01-01", "2024-01-02"),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("FixtureProvider", () => {
  it("is deterministic and independent of the requested start", async () => {
    const p = new FixtureProvider();
    const a = await p.getDailyBars("AAPL", "2024-01-01", "2024-02-01");
    const b = await p.getDailyBars("AAPL", "2023-12-01", "2024-02-01");
    expect(b.find((x) => x.date === a[0]!.date)).toEqual(a[0]);
    expect(a.every((x) => ![0, 6].includes(new Date(x.date).getUTCDay()))).toBe(true);
  });
});

describe("ingestPrices", () => {
  it("backfills, then only fetches new days, and is idempotent", async () => {
    const p = new FixtureProvider();
    const first = await ingestPrices(ctx.db, p, "NVDA", {
      backfillFrom: "2024-01-01",
      to: "2024-03-29",
    });
    expect(first.inserted).toBeGreaterThan(50);
    const second = await ingestPrices(ctx.db, p, "NVDA", {
      backfillFrom: "2024-01-01",
      to: "2024-03-29",
    });
    expect(second.inserted).toBe(0);
    const third = await ingestPrices(ctx.db, p, "NVDA", {
      backfillFrom: "2024-01-01",
      to: "2024-04-12",
    });
    expect(third.from).toBe("2024-03-30");
    expect(third.inserted).toBe(10);
  });

  it("rejects an unknown company", async () => {
    await expect(
      ingestPrices(ctx.db, new FixtureProvider(), "ZZZZ", {
        backfillFrom: "2024-01-01",
        to: "2024-01-31",
      }),
    ).rejects.toThrow(/unknown company/);
  });

  it("detects gaps", async () => {
    const [c] = await ctx.db.select().from(companies).where(eq(companies.ticker, "AAPL"));
    await ctx.db.insert(pricesDaily).values([
      { companyId: c!.id, date: "2024-01-02", close: 1, adjClose: 1 },
      { companyId: c!.id, date: "2024-01-03", close: 1, adjClose: 1 },
      { companyId: c!.id, date: "2024-01-20", close: 1, adjClose: 1 },
    ]);
    expect(await findPriceGaps(ctx.db, c!.id)).toEqual([
      { after: "2024-01-03", before: "2024-01-20", days: 17 },
    ]);
  });
});
