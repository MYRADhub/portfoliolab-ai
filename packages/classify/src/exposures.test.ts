import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { companies, companyFactorExposures, factors } from "@portfolio-lab/db";
import { createTestDb } from "@portfolio-lab/db/testing";
import {
  buildCompanyMessage,
  buildExposurePrompt,
  cleanDraft,
  draftAndStore,
  exposureAgreement,
  type DraftOutput,
  type ExposureDrafter,
} from "./index";

const close = (a: number | null, b: number, tol = 1e-12) =>
  expect(Math.abs(a! - b)).toBeLessThan(tol);
const slugs = new Set(["rates", "oil", "china"]);
const e = (
  factor: string,
  magnitude: number,
  direction: number,
  confidence = 0.7,
  rationale = "Because.",
) => ({
  factor,
  magnitude,
  direction,
  confidence,
  rationale,
});

describe("buildExposurePrompt", () => {
  it("lists every force with what a rise means, states the scale and forbids inventing forces", () => {
    const p = buildExposurePrompt([
      {
        slug: "rates",
        name: "Interest rates",
        description: "Policy rates.",
        risesMeans: "borrowing costs rise",
      },
      { slug: "oil", name: "Oil price", description: "Crude.", risesMeans: null },
    ]);
    expect(p).toContain(
      "- rates: Interest rates. Policy rates. When it rises: borrowing costs rise",
    );
    expect(p).toContain("- oil: Oil price. Crude.");
    expect(p).toMatch(/magnitude: 1 \(minor\), 2 \(meaningful\) or 3/);
    expect(p).toMatch(/never more than 6/);
    expect(p).toMatch(/Never invent a force/);
    expect(
      buildCompanyMessage({ ticker: "X", name: "Xco", sector: null, industry: "Widgets" }),
    ).toBe("Company: Xco (X)\nSector: unknown\nIndustry: Widgets");
  });
});

describe("cleanDraft", () => {
  it("drops unknown forces, zero magnitudes, zero or invalid directions and empty rationales", () => {
    const out = cleanDraft(
      {
        exposures: [
          e("rates", 2, -1),
          e("nope", 3, 1),
          e("oil", 0, 1),
          e("china", 2, 0),
          e("china", 2, 2),
          e("oil", 2, 1, 0.7, "  "),
        ],
      },
      slugs,
    );
    expect(out.map((x) => x.slug)).toEqual(["rates"]);
  });

  it("clamps magnitude to 3 and confidence to 0.3 to 0.8, trims and shortens the rationale", () => {
    const [x] = cleanDraft(
      { exposures: [e("rates", 9, 1, 0.99, `  ${"a".repeat(300)}  `)] },
      slugs,
    );
    expect(x).toMatchObject({ magnitude: 3, confidence: 0.8 });
    expect(x!.rationale).toHaveLength(200);
    expect(cleanDraft({ exposures: [e("rates", 1, 1, 0.01)] }, slugs)[0]!.confidence).toBe(0.3);
    expect(cleanDraft({ exposures: [e("rates", 1, 1, Number.NaN)] }, slugs)[0]!.confidence).toBe(
      0.3,
    );
  });

  it("keeps the strongest duplicate, sorts strongest first and caps the count", () => {
    const many: DraftOutput = {
      exposures: ["a", "b", "c", "d", "e", "f", "g", "h"].map((s, i) =>
        e(s, (i % 3) + 1, 1, 0.5 + i / 100),
      ),
    };
    const out = cleanDraft(many, new Set("abcdefgh".split("")));
    expect(out).toHaveLength(6);
    expect(out.map((x) => x.magnitude)).toEqual(
      [...out.map((x) => x.magnitude)].sort((a, b) => b - a),
    );
    const dup = cleanDraft({ exposures: [e("rates", 1, 1), e("rates", 3, -1)] }, slugs);
    expect(dup).toHaveLength(1);
    expect(dup[0]).toMatchObject({ magnitude: 3, direction: -1 });
  });
});

describe("exposureAgreement", () => {
  it("is perfect for identical profiles", () => {
    const a = exposureAgreement({ rates: -2, oil: 3 }, { rates: -2, oil: 3 });
    expect(a).toMatchObject({
      shared: 2,
      directionAgreement: 1,
      meanMagnitudeError: 0,
      recallStrong: 1,
      precisionStrong: 1,
    });
    close(a.cosine, 1);
  });

  it("matches a hand calculation", () => {
    // draft: rates -3, oil +1, china +2 ; reference: rates -2, oil -1, gold +3
    // dot = 6 - 1 = 5; |d| = sqrt(14), |r| = sqrt(14) -> cosine 5/14
    const a = exposureAgreement({ rates: -3, oil: 1, china: 2 }, { rates: -2, oil: -1, gold: 3 });
    close(a.cosine, 5 / 14);
    expect(a.shared).toBe(2);
    close(a.directionAgreement, 0.5); // rates agree, oil disagrees
    close(a.meanMagnitudeError, 0.5); // |3-2| and |1-1| give (1 + 0) / 2
  });

  it("computes recall and precision over strong forces only, and handles empty profiles", () => {
    // reference strong: rates, gold (2 or more); draft has rates but not gold -> recall 1/2
    // draft strong: rates, china; only rates is in the reference -> precision 1/2
    const a = exposureAgreement({ rates: -3, oil: 1, china: 2 }, { rates: -2, oil: -1, gold: 3 });
    close(a.recallStrong, 0.5);
    close(a.precisionStrong, 0.5);
    const none = exposureAgreement({}, { rates: 1 });
    expect(none).toMatchObject({
      cosine: null,
      shared: 0,
      directionAgreement: null,
      meanMagnitudeError: null,
      precisionStrong: null,
    });
  });
});

describe("draftAndStore", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    ctx = await createTestDb();
    await ctx.db.insert(companies).values([
      { ticker: "AAA", name: "Aaa Inc", sector: "Tech", industry: "Chips" },
      { ticker: "BBB", name: "Bbb Inc", sector: "Energy", industry: "Oil" },
      { ticker: "CCC", name: "Ccc Inc", sector: "Banks", industry: "Banks" },
    ]);
    await ctx.db.insert(factors).values([
      {
        slug: "rates",
        name: "Interest rates",
        category: "macro",
        description: "d",
        risesMeans: "m",
      },
      { slug: "oil", name: "Oil price", category: "commodity", description: "d" },
    ]);
  });
  afterAll(async () => {
    await ctx.teardown();
  });

  const fake = (
    answers: Record<string, DraftOutput | null | Error>,
  ): ExposureDrafter & { calls: string[] } => ({
    model: "fake",
    calls: [],
    async draft(c) {
      this.calls.push(c.ticker);
      const a = answers[c.ticker];
      if (a instanceof Error) throw a;
      return a ?? null;
    },
  });

  it("stores cleaned, labelled drafts, skips companies that already have profiles, and reports failures", async () => {
    // BBB gets a hand-made profile first: it must never be drafted or changed.
    const [bbb] = await ctx.db.select().from(companies).where(eq(companies.ticker, "BBB"));
    const [oil] = await ctx.db.select().from(factors).where(eq(factors.slug, "oil"));
    await ctx.db.insert(companyFactorExposures).values({
      companyId: bbb!.id,
      factorId: oil!.id,
      magnitude: 3,
      direction: 1,
      confidence: 0.9,
      rationale: "Reviewed by a person.",
      source: "manual",
    });

    const d = fake({
      AAA: { exposures: [e("rates", 2, -1, 0.99), e("bogus", 3, 1)] },
      CCC: new Error("upstream failed"),
    });
    const s = await draftAndStore(ctx.db, d, { concurrency: 1 });
    expect(d.calls.sort()).toEqual(["AAA", "CCC"]); // BBB was not drafted
    expect(s).toMatchObject({ drafted: 1, stored: 1, skippedExisting: 1 });
    expect(s.failed).toEqual([{ ticker: "CCC", reason: "upstream failed" }]);

    const rows = await ctx.db
      .select({
        ticker: companies.ticker,
        source: companyFactorExposures.source,
        conf: companyFactorExposures.confidence,
        why: companyFactorExposures.rationale,
        by: companyFactorExposures.reviewedBy,
      })
      .from(companyFactorExposures)
      .innerJoin(companies, eq(companies.id, companyFactorExposures.companyId))
      .where(isNull(companyFactorExposures.validTo));
    const aaa = rows.filter((r) => r.ticker === "AAA");
    expect(aaa).toHaveLength(1);
    expect(aaa[0]).toMatchObject({ source: "llm_seeded", conf: 0.8, by: null });
    expect(aaa[0]!.why).toBe("AI-drafted, not reviewed: Because.");
    const manual = rows.filter((r) => r.ticker === "BBB");
    expect(manual).toEqual([
      expect.objectContaining({ source: "manual", conf: 0.9, why: "Reviewed by a person." }),
    ]);
  });

  it("is a no-op the second time, and treats a null answer or an all-invalid answer as a failure", async () => {
    const again = fake({});
    const s = await draftAndStore(ctx.db, again, { concurrency: 1 });
    expect(again.calls).toEqual(["CCC"]); // the only company still without a profile
    expect(s.failed).toEqual([{ ticker: "CCC", reason: "no usable answer" }]);
    const bad = fake({ CCC: { exposures: [e("bogus", 3, 1)] } });
    expect((await draftAndStore(ctx.db, bad)).failed).toEqual([
      { ticker: "CCC", reason: "no valid exposures" },
    ]);
    const count = await ctx.db
      .select()
      .from(companyFactorExposures)
      .where(and(isNull(companyFactorExposures.validTo)));
    expect(count).toHaveLength(2);
  });

  it("respects a ticker filter and a limit", async () => {
    const d = fake({ CCC: { exposures: [e("rates", 1, 1)] } });
    await draftAndStore(ctx.db, d, { tickers: ["CCC"], limit: 1 });
    expect(d.calls).toEqual(["CCC"]);
  });
});
