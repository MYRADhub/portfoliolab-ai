import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { normalizeForQuote } from "@portfolio-lab/data";
import { companies, companyFactorExposures, factors } from "@portfolio-lab/db";
import { createTestDb } from "@portfolio-lab/db/testing";
import {
  buildGroundedPrompt,
  buildReportMessage,
  checkRun,
  combineRuns,
  draftGroundedAndStore,
  DRAFT_LABEL,
  type AnnualReport,
  type CheckedRun,
  type GroundedDrafter,
  type GroundedOutput,
} from "./index";

const RATES_QUOTE = "higher interest rates increase our borrowing costs and reduce demand";
const OIL_QUOTE = "our results depend heavily on the price of crude oil";
const report: AnnualReport = {
  url: "https://www.sec.gov/Archives/edgar/data/1/0001/k.htm",
  filingDate: "2025-02-01",
  reportDate: "2024-12-31",
  business: `We refine fuel. Our results depend heavily on the price of crude oil, which we buy daily.`,
  risks: `Higher interest rates increase our borrowing costs and reduce demand for new projects.`,
};
const source = normalizeForQuote(`${report.business}\n${report.risks}`);
const slugs = new Set(["rates", "oil", "china"]);
const x = (factor: string, magnitude: number, direction: number, evidence: string) => ({
  factor,
  magnitude,
  direction,
  rationale: `Because of ${factor}.`,
  evidence,
});

describe("prompt", () => {
  it("restricts the model to the report, asks for verbatim evidence and lists every force", () => {
    const p = buildGroundedPrompt([
      { slug: "rates", name: "Interest rates", description: "d", risesMeans: "borrowing costs up" },
    ]);
    expect(p).toContain("ONLY on these excerpts");
    expect(p).toContain("word for word");
    expect(p).toContain("- rates: Interest rates. d When it rises: borrowing costs up");
    const m = buildReportMessage(
      { ticker: "AAA", name: "Aaa Inc", sector: "Energy", industry: null },
      report,
    );
    expect(m).toContain("Annual report filed 2025-02-01 for the fiscal year ending 2024-12-31.");
    expect(m).toContain(report.risks);
  });
});

describe("checkRun", () => {
  it("keeps exposures whose evidence is in the report, ignoring case and punctuation", () => {
    const r = checkRun(
      {
        exposures: [
          x("oil", 3, 1, "Our results depend heavily on the price of crude oil,"),
          x("rates", 2, -1, RATES_QUOTE.toUpperCase()),
        ],
      },
      slugs,
      source,
    );
    expect(r.unverified).toBe(0);
    expect(r.scores.get("oil")).toMatchObject({ signed: 3 });
    expect(r.scores.get("rates")).toMatchObject({ signed: -2 });
  });

  it("drops paraphrased, invented or too-short evidence and counts it, and ignores invalid scores", () => {
    const r = checkRun(
      {
        exposures: [
          x("oil", 3, 1, "Our profits rise and fall with the price of crude oil"),
          x("rates", 2, -1, "interest rates"),
          x("china", 2, 1, "We sell a large share of our products in China every year"),
          x("unknown", 2, 1, OIL_QUOTE),
          x("oil", 0, 1, OIL_QUOTE),
          x("rates", 2, 0, RATES_QUOTE),
        ],
      },
      slugs,
      source,
    );
    expect(r.scores.size).toBe(0);
    expect(r.unverified).toBe(3);
  });

  it("caps magnitude at 3 and keeps the strongest duplicate", () => {
    const r = checkRun(
      { exposures: [x("oil", 1, 1, OIL_QUOTE), x("oil", 5, 1, OIL_QUOTE)] },
      slugs,
      source,
    );
    expect(r.scores.get("oil")!.signed).toBe(3);
  });
});

const run = (scores: Record<string, number>): CheckedRun => ({
  unverified: 0,
  scores: new Map(
    Object.entries(scores).map(([k, v]) => [
      k,
      { signed: v, rationale: `r${v}`, evidence: `e${v}` },
    ]),
  ),
});

describe("combineRuns", () => {
  it("takes the median per force, counting runs that left a force out as zero", () => {
    const out = combineRuns([
      run({ oil: 3, rates: -2 }),
      run({ oil: 3, rates: -1 }),
      run({ oil: 2 }),
      run({ oil: 3, china: 1 }),
      run({ oil: 3, rates: -2 }),
    ]);
    // oil: 3,3,2,3,3 -> 3 (4 of 5). rates: -2,-1,0,0,-2 -> -1 (1 of 5). china: 1,0,0,0,0 -> dropped.
    expect(out.map((e) => [e.slug, e.magnitude * e.direction, e.stability])).toEqual([
      ["oil", 3, 0.8],
      ["rates", -1, 0.2],
    ]);
    expect(out[0]!.confidence).toBeCloseTo(0.3 + 0.5 * 0.8, 12);
    expect(out[1]!.confidence).toBeCloseTo(0.4, 12);
    // the wording comes from a run that gave the median score
    expect(out[1]!.rationale).toBe("r-1");
  });

  it("gives full stability and the top confidence when every run agrees, and is empty for no runs", () => {
    const out = combineRuns([run({ oil: 2 }), run({ oil: 2 }), run({ oil: 2 })]);
    expect(out).toMatchObject([{ slug: "oil", stability: 1, confidence: 0.8 }]);
    expect(combineRuns([])).toEqual([]);
  });

  it("with an even number of runs takes the middle value closer to zero", () => {
    // sorted -1,0,2,3: middle values 0 and 2 -> 0, so the force is dropped
    expect(combineRuns([run({ oil: 3 }), run({ oil: 2 }), run({ oil: -1 }), run({})])).toEqual([]);
    // sorted 1,2,3,3: middle values 2 and 3 -> 2, given by one run of four
    expect(
      combineRuns([run({ oil: 3 }), run({ oil: 2 }), run({ oil: 1 }), run({ oil: 3 })]),
    ).toMatchObject([{ slug: "oil", magnitude: 2, stability: 0.25, rationale: "r2" }]);
  });
});

describe("draftGroundedAndStore", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  const ids: Record<string, number> = {};
  beforeAll(async () => {
    ctx = await createTestDb();
    const rows = await ctx.db
      .insert(companies)
      .values([
        { ticker: "DRF", name: "Draft Inc", sector: "Energy", cik: "1" },
        { ticker: "HUM", name: "Human Inc", sector: "Energy", cik: "2" },
        { ticker: "NEW", name: "New Inc", sector: "Energy", cik: "3" },
        { ticker: "NOR", name: "No Report Inc", sector: "Energy", cik: null },
        { ticker: "BAD", name: "Bad Answers Inc", sector: "Energy", cik: "5" },
      ])
      .returning();
    for (const r of rows) ids[r.ticker] = r.id;
    const fs = await ctx.db
      .insert(factors)
      .values([
        { slug: "rates", name: "Interest rates", category: "macro", description: "d" },
        { slug: "oil", name: "Oil price", category: "commodity", description: "d" },
      ])
      .returning();
    const oil = fs.find((f) => f.slug === "oil")!.id;
    await ctx.db.insert(companyFactorExposures).values([
      {
        companyId: ids.DRF!,
        factorId: oil,
        magnitude: 1,
        direction: -1,
        confidence: 0.5,
        rationale: `${DRAFT_LABEL} From memory.`,
        source: "llm_seeded",
      },
      {
        companyId: ids.HUM!,
        factorId: oil,
        magnitude: 2,
        direction: 1,
        confidence: 0.9,
        rationale: "Checked by an analyst.",
        source: "manual",
      },
    ]);
  });
  afterAll(async () => {
    await ctx.teardown();
  });

  const good: GroundedOutput = {
    exposures: [x("oil", 3, 1, OIL_QUOTE), x("rates", 2, -1, RATES_QUOTE)],
  };
  const drafter = (answers: (GroundedOutput | null)[]): GroundedDrafter & { calls: number } => ({
    model: "fake",
    calls: 0,
    async draft(c) {
      const i = this.calls++;
      return {
        output: c.ticker === "BAD" ? null : (answers[i % answers.length] ?? null),
        usage: { input: 1000, cachedInput: i % 5 === 0 ? 0 : 900, output: 50 },
      };
    },
  });
  const reports = {
    async get(c: { ticker: string; cik: string | null }) {
      return c.cik ? report : null;
    },
  };

  const current = (ticker: string) =>
    ctx.db
      .select()
      .from(companyFactorExposures)
      .where(
        and(
          eq(companyFactorExposures.companyId, ids[ticker]!),
          isNull(companyFactorExposures.validTo),
        ),
      );

  it("replaces memory drafts with grounded ones, never touches reviewed rows, and reports failures", async () => {
    const d = drafter([good]);
    const s = await draftGroundedAndStore(ctx.db, d, reports, { runs: 5, concurrency: 1 });
    expect(s.drafted).toBe(2); // DRF and NEW
    expect(s.skipped).toBe(1); // HUM, reviewed
    expect(s.failed.map((f) => f.ticker).sort()).toEqual(["BAD", "NOR"]);
    expect(s.usage).toEqual({ input: 15000, cachedInput: 10800, output: 750 });

    const drf = await current("DRF");
    expect(drf).toHaveLength(2);
    for (const r of drf) {
      expect(r.version).toBe(2);
      expect(r.stability).toBe(1);
      expect(r.confidence).toBeCloseTo(0.8, 12);
      expect(r.rationale!.startsWith(DRAFT_LABEL)).toBe(true);
      expect(r.evidenceUrls).toEqual([report.url]);
      expect([OIL_QUOTE, RATES_QUOTE]).toContain(r.evidenceQuote);
    }
    // the memory draft is kept as history
    const all = await ctx.db
      .select()
      .from(companyFactorExposures)
      .where(eq(companyFactorExposures.companyId, ids.DRF!));
    expect(all.filter((r) => r.validTo !== null)).toHaveLength(1);
    expect((await current("NEW"))[0]!.version).toBe(1);
    expect(await current("HUM")).toMatchObject([{ rationale: "Checked by an analyst." }]);
  });

  it("skips companies already grounded, so a rerun costs nothing", async () => {
    const d = drafter([good]);
    const s = await draftGroundedAndStore(ctx.db, d, reports, {
      tickers: ["DRF", "NEW", "HUM"],
    });
    expect(s).toMatchObject({ drafted: 0, skipped: 3 });
    expect(d.calls).toBe(0);
  });
});
