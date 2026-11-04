import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@portfolio-lab/db/testing";
import { AI_ALLOWANCES, AiLimiter, clientIp } from "./ai-guard";
import { tryAcquireAll } from "./rate-limit";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  ctx = await createTestDb();
});
afterAll(async () => {
  await ctx.teardown();
});

const at = (iso: string) => () => new Date(iso);

describe("tryAcquireAll", () => {
  it("records against every limit only when all have room, and names the first full one", async () => {
    const now = new Date("2026-11-03T10:00:00Z");
    const checks = [
      { key: "t:a", max: 5, windowMs: 60_000 },
      { key: "t:b", max: 1, windowMs: 60_000 },
    ];
    expect(await tryAcquireAll(ctx.db, checks, now)).toBeNull();
    expect(await tryAcquireAll(ctx.db, checks, now)).toBe(1);
    // The refused attempt was not recorded against "t:a": four more fit there on their own.
    for (let i = 0; i < 4; i++) expect(await tryAcquireAll(ctx.db, [checks[0]!], now)).toBeNull();
    expect(await tryAcquireAll(ctx.db, [checks[0]!], now)).toBe(0);
    // Outside the window the old hits no longer count.
    expect(await tryAcquireAll(ctx.db, checks, new Date(now.getTime() + 61_000))).toBeNull();
  });

  it("does not let concurrent callers slip past a limit", async () => {
    const now = new Date("2026-11-03T11:00:00Z");
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        tryAcquireAll(ctx.db, [{ key: "t:race", max: 3, windowMs: 60_000 }], now),
      ),
    );
    expect(results.filter((r) => r === null)).toHaveLength(3);
  });
});

describe("AiLimiter", () => {
  it("returns false when the session allowance is full, so the feature keeps its own message", async () => {
    const lim = new AiLimiter(ctx.db, "deck", "10.0.0.1", { now: at("2026-11-03T12:00:00Z") });
    const max = AI_ALLOWANCES.deck.session.max;
    for (let i = 0; i < max; i++) expect(await lim.tryAcquire("deck:s1")).toBe(true);
    expect(await lim.tryAcquire("deck:s1")).toBe(false);
  });

  it("limits one network address across many sessions", async () => {
    const lim = new AiLimiter(ctx.db, "research_deep", "10.0.0.2", {
      now: at("2026-11-03T12:00:00Z"),
    });
    const perIp = AI_ALLOWANCES.research_deep.perIpHour;
    for (let i = 0; i < perIp; i++) expect(await lim.tryAcquire(`research:deep:s${i}`)).toBe(true);
    await expect(lim.tryAcquire("research:deep:fresh")).rejects.toMatchObject({
      code: "rate_limited",
      message: expect.stringMatching(/from your network/),
    });
    // Another address is unaffected.
    const other = new AiLimiter(ctx.db, "research_deep", "10.0.0.3", {
      now: at("2026-11-03T12:00:00Z"),
    });
    expect(await other.tryAcquire("research:deep:other")).toBe(true);
  });

  it("stops every address once the site-wide daily budget is spent, and scales with the setting", async () => {
    const opts = { now: at("2026-11-03T13:00:00Z"), scale: 0.05 };
    const budget = Math.round(AI_ALLOWANCES.news_scan.perDay * 0.05);
    for (let i = 0; i < budget; i++) {
      const lim = new AiLimiter(ctx.db, "news_scan", `10.1.0.${i}`, opts);
      expect(await lim.tryAcquire(`news-scan:s${i}`)).toBe(true);
    }
    const late = new AiLimiter(ctx.db, "news_scan", "10.1.9.9", opts);
    await expect(late.tryAcquire("news-scan:late")).rejects.toMatchObject({
      code: "rate_limited",
      message: expect.stringMatching(/daily allowance of news scans/),
    });
    // A day later the budget is free again.
    const tomorrow = new AiLimiter(ctx.db, "news_scan", "10.1.9.9", {
      ...opts,
      now: at("2026-11-04T13:00:01Z"),
    });
    expect(await tomorrow.tryAcquire("news-scan:late")).toBe(true);
  });

  it("refuses everything when AI is switched off", async () => {
    const lim = new AiLimiter(ctx.db, "explain", "10.2.0.1", { enabled: false });
    await expect(lim.tryAcquire("explain:s")).rejects.toMatchObject({
      code: "unavailable",
      message: expect.stringMatching(/switched off/),
    });
  });
});

describe("clientIp", () => {
  const req = (h: Record<string, string>) => new Request("http://x/", { headers: h });
  it("prefers the edge's real address, then the first forwarded one", () => {
    expect(clientIp(req({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }))).toBe("1.2.3.4");
    expect(clientIp(req({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" }))).toBe("5.6.7.8");
    expect(clientIp(req({}))).toBe("unknown");
  });
});
