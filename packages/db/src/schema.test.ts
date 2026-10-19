import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  companies,
  companyFactorExposures,
  factors,
  holdings,
  portfolios,
  sessions,
} from "./schema";
import { createTestDb } from "./testing";
import { seedDevCompanies } from "./seed/companies";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});
afterAll(async () => {
  await ctx.teardown();
});

async function firstFactor() {
  const [f] = await ctx.db
    .insert(factors)
    .values({
      slug: `f_${Math.random().toString(36).slice(2)}`,
      name: "F",
      category: "macro",
      description: "d",
    })
    .returning();
  return f!;
}

describe("seed", () => {
  it("is idempotent", async () => {
    await seedDevCompanies(ctx.db);
    await seedDevCompanies(ctx.db);
    const rows = await ctx.db.select().from(companies);
    expect(rows).toHaveLength(5);
  });
});

describe("exposure constraints", () => {
  const base = { confidence: 0.8, source: "manual" as const };

  it("accepts a valid signed exposure", async () => {
    const [c] = await ctx.db.select().from(companies).where(eq(companies.ticker, "NVDA"));
    const f = await firstFactor();
    await expect(
      ctx.db
        .insert(companyFactorExposures)
        .values({ companyId: c!.id, factorId: f.id, magnitude: 3, direction: -1, ...base }),
    ).resolves.toBeDefined();
  });

  it("rejects magnitude out of range, bad direction, and mismatched zero", async () => {
    const [c] = await ctx.db.select().from(companies).where(eq(companies.ticker, "AAPL"));
    const f = await firstFactor();
    const ins = (magnitude: number, direction: number) =>
      ctx.db
        .insert(companyFactorExposures)
        .values({ companyId: c!.id, factorId: f.id, magnitude, direction, ...base });
    await expect(ins(4, 1)).rejects.toThrow();
    await expect(ins(1, 2)).rejects.toThrow();
    await expect(ins(0, 1)).rejects.toThrow();
    await expect(ins(2, 0)).rejects.toThrow();
  });

  it("allows only one current row per company and factor, but keeps history", async () => {
    const [c] = await ctx.db.select().from(companies).where(eq(companies.ticker, "MSFT"));
    const f = await firstFactor();
    const row = { companyId: c!.id, factorId: f.id, magnitude: 2, direction: 1, ...base };
    await ctx.db.insert(companyFactorExposures).values(row);
    await expect(ctx.db.insert(companyFactorExposures).values(row)).rejects.toThrow();
    await ctx.db
      .update(companyFactorExposures)
      .set({ validTo: new Date() })
      .where(eq(companyFactorExposures.factorId, f.id));
    await expect(
      ctx.db.insert(companyFactorExposures).values({ ...row, version: 2 }),
    ).resolves.toBeDefined();
  });
});

describe("portfolio constraints", () => {
  it("rejects weights outside (0, 1] and cascades on session delete", async () => {
    const [s] = await ctx.db.insert(sessions).values({}).returning();
    const [p] = await ctx.db.insert(portfolios).values({ sessionId: s!.id, name: "p" }).returning();
    const [c] = await ctx.db.select().from(companies).where(eq(companies.ticker, "JPM"));
    const ins = (weight: number) =>
      ctx.db.insert(holdings).values({ portfolioId: p!.id, companyId: c!.id, weight });
    await expect(ins(0)).rejects.toThrow();
    await expect(ins(1.2)).rejects.toThrow();
    await expect(ins(0.5)).resolves.toBeDefined();
    await ctx.db.delete(sessions).where(eq(sessions.id, s!.id));
    expect(
      await ctx.db.select().from(holdings).where(eq(holdings.portfolioId, p!.id)),
    ).toHaveLength(0);
  });
});
