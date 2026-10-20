import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sessions } from "@portfolio-lab/db";
import { createTestDb } from "@portfolio-lab/db/testing";
import { loadConstituents, type Constituent } from "@portfolio-lab/data";
import { listPortfolios } from "./portfolios";
import { loadSamples, SAMPLES } from "./samples";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let universe: Set<string>;

beforeAll(async () => {
  ctx = await createTestDb();
  const dir = resolve(__dirname, "../../../../packages/data/snapshots");
  const file = readdirSync(dir)
    .filter((f) => f.startsWith("sp500-"))
    .sort()
    .at(-1)!;
  const items = JSON.parse(readFileSync(`${dir}/${file}`, "utf8")) as Constituent[];
  universe = new Set(items.map((c) => c.ticker));
  await loadConstituents(ctx.db, items);
});
afterAll(async () => {
  await ctx.teardown();
});

describe("sample definitions", () => {
  it("have unique keys and names, weights that sum to 100, no duplicate tickers, and real S&P 500 members", () => {
    expect(new Set(SAMPLES.map((s) => s.key)).size).toBe(SAMPLES.length);
    expect(new Set(SAMPLES.map((s) => s.name)).size).toBe(SAMPLES.length);
    for (const s of SAMPLES) {
      expect(
        s.holdings.reduce((a, h) => a + h.weightPct, 0),
        s.key,
      ).toBeCloseTo(100, 9);
      expect(new Set(s.holdings.map((h) => h.ticker)).size, s.key).toBe(s.holdings.length);
      for (const h of s.holdings) expect(universe.has(h.ticker), `${s.key}:${h.ticker}`).toBe(true);
      expect(s.blurb.length).toBeGreaterThan(10);
      expect(s.lesson.length).toBeGreaterThan(10);
    }
  });
});

describe("loadSamples", () => {
  it("creates every sample in the visitor's session, in display order, and does nothing the second time", async () => {
    const [s] = await ctx.db.insert(sessions).values({}).returning();
    const first = await loadSamples(ctx.db, s!.id);
    expect(first.created.map((c) => c.key)).toEqual(SAMPLES.map((x) => x.key));
    expect(first.existing).toEqual([]);
    expect(first.skipped).toEqual([]);
    expect(await listPortfolios(ctx.db, s!.id)).toHaveLength(SAMPLES.length);

    const second = await loadSamples(ctx.db, s!.id);
    expect(second.created).toEqual([]);
    expect(second.existing.map((e) => e.key)).toEqual(SAMPLES.map((x) => x.key));
    expect(await listPortfolios(ctx.db, s!.id)).toHaveLength(SAMPLES.length);
  });

  it("loads only the chosen samples, keeps sessions separate, and rejects unknown keys", async () => {
    const [a] = await ctx.db.insert(sessions).values({}).returning();
    const [b] = await ctx.db.insert(sessions).values({}).returning();
    const r = await loadSamples(ctx.db, a!.id, ["balanced"]);
    expect(r.created.map((c) => c.key)).toEqual(["balanced"]);
    expect(await listPortfolios(ctx.db, b!.id)).toHaveLength(0);
    await expect(loadSamples(ctx.db, a!.id, ["nope"])).rejects.toMatchObject({
      code: "bad_request",
    });
    expect(await listPortfolios(ctx.db, a!.id)).toHaveLength(1);
  });

  it("skips, with a reason, a sample whose companies are not loaded instead of failing the rest", async () => {
    const empty = await createTestDb(); // no companies at all
    try {
      const [s] = await empty.db.insert(sessions).values({}).returning();
      const r = await loadSamples(empty.db, s!.id, ["balanced", "ai-boom"]);
      expect(r.created).toEqual([]);
      expect(r.skipped.map((x) => x.key).sort()).toEqual(["ai-boom", "balanced"]);
      expect(r.skipped[0]!.reason).toMatch(/Unknown tickers/);
    } finally {
      await empty.teardown();
    }
  });
});
