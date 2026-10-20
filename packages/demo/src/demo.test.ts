import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@portfolio-lab/db/testing";
import {
  companyFactorExposures,
  factors,
  newsArticles,
  newsCompanyLinks,
  pricesDaily,
} from "@portfolio-lab/db";
import { loadConstituents, type Constituent } from "@portfolio-lab/data";
import { DEMO_EXPOSURES, DEMO_FACTORS, DEMO_NEWS, DEMO_TICKERS, seedDemoData } from "./index";

describe("demo data definitions", () => {
  const tickers = new Set<string>(DEMO_TICKERS);
  const slugs = new Set(DEMO_FACTORS.map((f) => f.slug));

  it("refers only to known tickers and factors with valid scores and no duplicate pairs", () => {
    const seen = new Set<string>();
    for (const [t, slug, magnitude, direction, confidence] of DEMO_EXPOSURES) {
      expect(tickers.has(t), t).toBe(true);
      expect(slugs.has(slug), slug).toBe(true);
      expect(magnitude).toBeGreaterThanOrEqual(1);
      expect(magnitude).toBeLessThanOrEqual(3);
      expect([-1, 1]).toContain(direction);
      expect(confidence).toBeGreaterThan(0);
      expect(confidence).toBeLessThanOrEqual(1);
      expect(seen.has(`${t}:${slug}`), `${t}:${slug} repeated`).toBe(false);
      seen.add(`${t}:${slug}`);
    }
  });

  it("gives every demo company at least two exposures and every factor at least one company", () => {
    for (const t of DEMO_TICKERS)
      expect(DEMO_EXPOSURES.filter((e) => e[0] === t).length, t).toBeGreaterThanOrEqual(2);
    for (const f of DEMO_FACTORS)
      expect(
        DEMO_EXPOSURES.some((e) => e[1] === f.slug),
        f.slug,
      ).toBe(true);
  });

  it("labels every news item as demo data and links only to demo tickers", () => {
    for (const n of DEMO_NEWS) {
      expect(n.title.startsWith("[DEMO]"), n.title).toBe(true);
      for (const t of n.tickers) expect(tickers.has(t), t).toBe(true);
      expect(n.importance).toBeGreaterThanOrEqual(1);
      expect(n.importance).toBeLessThanOrEqual(10);
    }
    expect(new Set(DEMO_NEWS.map((n) => n.title)).size).toBe(DEMO_NEWS.length);
  });
});

describe("seedDemoData", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    ctx = await createTestDb();
    const dir = resolve(__dirname, "../../data/snapshots/");
    const file = readdirSync(dir)
      .filter((f) => f.startsWith("sp500-"))
      .sort()
      .at(-1)!;
    await loadConstituents(
      ctx.db,
      JSON.parse(readFileSync(`${dir}/${file}`, "utf8")) as Constituent[],
    );
  });
  afterAll(async () => {
    await ctx.teardown();
  });

  it("loads prices, factors, exposures and news, and does nothing the second time", async () => {
    const first = await seedDemoData(ctx.db, { years: 1 });
    expect(first.pricedTickers).toBe(DEMO_TICKERS.length);
    expect(first.factors).toBe(DEMO_FACTORS.length);
    expect(first.exposures).toBe(DEMO_EXPOSURES.length);
    const copies = DEMO_NEWS.filter((n) => n.copyTitle).length;
    expect(first.articles).toBe(DEMO_NEWS.length + copies);

    const second = await seedDemoData(ctx.db, { years: 1 });
    expect(second.exposures).toBe(0);
    expect(second.articles).toBe(0);
    expect(await ctx.db.select().from(factors)).toHaveLength(DEMO_FACTORS.length);
    expect(await ctx.db.select().from(companyFactorExposures)).toHaveLength(DEMO_EXPOSURES.length);
    expect((await ctx.db.select().from(newsArticles)).length).toBe(first.articles);
    expect((await ctx.db.select().from(pricesDaily)).length).toBeGreaterThan(24 * 200);
    expect((await ctx.db.select().from(newsCompanyLinks)).length).toBeGreaterThan(DEMO_NEWS.length);
  });
});
