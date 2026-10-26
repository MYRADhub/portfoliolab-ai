import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { blindReviews, companies, companyFactorExposures, factors } from "@portfolio-lab/db";
import { createTestDb } from "@portfolio-lab/db/testing";
import { agreementCsv, getDraftAgreement } from "./agreement";
import { AppError } from "./errors";
import { getReviewProfile, listForReview, saveReviewedProfile } from "./review";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
const goldSet = ["AAA", "BBB", "CCC"];
const ids: Record<string, number> = {};
const fids: Record<string, number> = {};

const row = (slug: string, magnitude: number, direction: 1 | -1) => ({
  slug,
  magnitude,
  direction,
  confidence: 0.8,
  rationale: "Checked against the annual report.",
});

beforeAll(async () => {
  ctx = await createTestDb();
  for (const f of await ctx.db
    .insert(factors)
    .values(
      ["rates", "oil", "china"].map((slug) => ({
        slug,
        name: slug,
        category: "macro" as const,
        description: slug,
      })),
    )
    .returning())
    fids[f.slug] = f.id;
  for (const c of await ctx.db
    .insert(companies)
    .values(["AAA", "BBB", "CCC", "ZZZ"].map((t) => ({ ticker: t, name: t })))
    .returning())
    ids[c.ticker] = c.id;
  const draft = (ticker: string, slug: string, magnitude: number, direction: number) => ({
    companyId: ids[ticker]!,
    factorId: fids[slug]!,
    magnitude,
    direction,
    confidence: 0.7,
    rationale: "AI-drafted, not reviewed: because.",
    source: "llm_seeded" as const,
  });
  await ctx.db
    .insert(companyFactorExposures)
    .values([
      draft("AAA", "rates", 2, -1),
      draft("AAA", "oil", 1, 1),
      draft("BBB", "oil", 3, 1),
      draft("ZZZ", "china", 2, 1),
    ]);
});
afterAll(async () => {
  await ctx.teardown();
});

const openRows = (ticker: string) =>
  ctx.db
    .select()
    .from(companyFactorExposures)
    .where(
      and(
        eq(companyFactorExposures.companyId, ids[ticker]!),
        isNull(companyFactorExposures.validTo),
      ),
    );

describe("blind review", () => {
  it("hides the draft scores but keeps the force list", async () => {
    const p = await getReviewProfile(ctx.db, "AAA", { blind: true, goldSet });
    expect(p.rows).toEqual([]);
    expect(p.forces.map((f) => f.slug).sort()).toEqual(["china", "oil", "rates"]);
    expect(p.status).toBe("draft");
  });

  it("refuses companies outside the gold set or without a draft", async () => {
    await expect(getReviewProfile(ctx.db, "ZZZ", { blind: true, goldSet })).rejects.toThrow(
      AppError,
    );
    await expect(getReviewProfile(ctx.db, "CCC", { blind: true, goldSet })).rejects.toThrow(
      /no AI draft/,
    );
  });

  it("records the blind scores and replaces the draft with them", async () => {
    await saveReviewedProfile(
      ctx.db,
      "AAA",
      { reviewer: "Ada", blind: true, rows: [row("rates", 2, -1), row("china", 1, 1)] },
      { goldSet },
    );
    const [b] = await ctx.db.select().from(blindReviews);
    expect(b).toMatchObject({ reviewer: "Ada", aiVersion: 1 });
    expect(b!.scores).toEqual([
      { slug: "rates", magnitude: 2, direction: -1 },
      { slug: "china", magnitude: 1, direction: 1 },
    ]);
    const open = await openRows("AAA");
    expect(open.map((r) => r.source)).toEqual(["manual", "manual"]);
  });

  it("allows one blind score per person, and a second person's blind score leaves the reviewed profile alone", async () => {
    await expect(
      saveReviewedProfile(
        ctx.db,
        "AAA",
        { reviewer: "Ada", blind: true, rows: [row("oil", 1, 1)] },
        { goldSet },
      ),
    ).rejects.toThrow(/already scored/);
    await saveReviewedProfile(
      ctx.db,
      "AAA",
      { reviewer: "Bo", blind: true, rows: [row("rates", 3, -1)] },
      { goldSet },
    );
    const open = await openRows("AAA");
    expect(open.every((r) => r.reviewedBy === "Ada")).toBe(true);
    expect(await ctx.db.select().from(blindReviews)).toHaveLength(2);
  });

  it("flags gold companies and who scored them in the review list", async () => {
    const gold = await listForReview(ctx.db, { status: "gold", goldSet });
    expect(gold.map((c) => c.ticker)).toEqual(["AAA", "BBB", "CCC"]);
    expect(gold[0]).toMatchObject({ gold: true, blindBy: ["Ada", "Bo"] });
    const all = await listForReview(ctx.db, { goldSet });
    expect(all.find((c) => c.ticker === "ZZZ")).toMatchObject({ gold: false, blindBy: [] });
  });
});

describe("getDraftAgreement", () => {
  it("compares each company's first blind score with the hidden draft, and people with each other", async () => {
    await saveReviewedProfile(
      ctx.db,
      "BBB",
      { reviewer: "Ada", blind: true, rows: [row("oil", 3, 1)] },
      { goldSet },
    );
    const a = await getDraftAgreement(ctx.db, { goldSet, resamples: 100 });
    expect(a.goldSize).toBe(3);
    expect(a.reviewers).toEqual(["Ada", "Bo"]);
    expect(a.ai.companies).toBe(2);
    expect(a.ai.cells).toBe(6);
    const aaa = a.cells.filter((c) => c.ticker === "AAA");
    expect(aaa).toEqual([
      { ticker: "AAA", force: "china", ai: 0, human: 1, reviewer: "Ada" },
      { ticker: "AAA", force: "oil", ai: 1, human: 0, reviewer: "Ada" },
      { ticker: "AAA", force: "rates", ai: -2, human: -2, reviewer: "Ada" },
    ]);
    expect(a.humans?.companies).toBe(1);
    expect(agreementCsv(a).split("\n")[0]).toBe("ticker,force,ai_score,human_score,reviewer");
    expect(agreementCsv(a)).toContain('AAA,rates,-2,-2,"Ada"');
  });
});
