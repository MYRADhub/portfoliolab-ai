import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  companies,
  eventTypes,
  fundamentals,
  newsArticles,
  newsClassifications,
} from "@portfolio-lab/db";
import { createTestDb } from "@portfolio-lab/db/testing";
import {
  EdgarClient,
  eventForItems,
  extractAnnual,
  filingUrl,
  ingestEightKs,
  ingestFundamentals,
  parseEightKs,
} from "./index";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  ctx = await createTestDb();
  await ctx.db.insert(companies).values({ ticker: "ACME", name: "Acme Corp", cik: "0000123456" });
  await ctx.db.insert(companies).values({ ticker: "NOCIK", name: "No Cik Inc" });
});
afterAll(async () => {
  await ctx.teardown();
});

const submissions = {
  cik: "123456",
  filings: {
    recent: {
      accessionNumber: ["0001-26-000003", "0001-26-000002", "0001-26-000001", "0001-25-000009"],
      filingDate: ["2026-05-04", "2026-04-01", "2026-03-01", "2025-01-10"],
      acceptanceDateTime: [
        "2026-05-04T20:15:00.000Z",
        "2026-04-01T13:00:00.000Z",
        "2026-03-01T15:00:00.000Z",
        "2025-01-10T15:00:00.000Z",
      ],
      form: ["8-K", "10-Q", "8-K", "8-K"],
      items: ["2.02,9.01", "", "7.01,9.01", "5.02"],
      primaryDocument: ["a.htm", "b.htm", "c.htm", "d.htm"],
    },
  },
};

describe("eventForItems", () => {
  it("names the event after the most important mapped item and ignores exhibits and Reg FD", () => {
    const e = eventForItems(["9.01", "2.02", "7.01"])!;
    expect(e).toMatchObject({ slug: "earnings_release", primaryItem: "2.02", importance: 7 });
    expect(e.descriptions).toEqual(["Item 2.02: Results of operations and financial condition"]);
    expect(eventForItems(["5.02", "8.01"])!.slug).toBe("leadership_change");
  });

  it("returns null when nothing maps, and breaks importance ties by item number", () => {
    expect(eventForItems(["7.01", "9.01"])).toBeNull();
    expect(eventForItems([])).toBeNull();
    expect(eventForItems(["2.05", "2.06"])!.primaryItem).toBe("2.05");
  });
});

describe("parseEightKs", () => {
  it("keeps only 8-K filings since the cutoff, newest first, with split items and UTC acceptance time", () => {
    const f = parseEightKs(submissions, "2026-01-01");
    expect(f.map((x) => x.accession)).toEqual(["0001-26-000003", "0001-26-000001"]);
    expect(f[0]!.items).toEqual(["2.02", "9.01"]);
    expect(f[0]!.acceptedAt.toISOString()).toBe("2026-05-04T20:15:00.000Z");
    expect(parseEightKs(submissions, "2025-01-01")).toHaveLength(3);
  });

  it("builds the filing URL without leading zeros or dashes and rejects other shapes", () => {
    const f = parseEightKs(submissions, "2026-01-01")[0]!;
    expect(filingUrl("0000123456", f)).toBe(
      "https://www.sec.gov/Archives/edgar/data/123456/000126000003/a.htm",
    );
    expect(() => parseEightKs({ nope: 1 }, "2026-01-01")).toThrow(/unexpected/);
  });
});

const fact = (
  end: string,
  val: number,
  extra: Partial<{ start: string; form: string; filed: string; accn: string }> = {},
) => ({
  start: `${Number(end.slice(0, 4)) - 1}${end.slice(4)}`,
  end,
  val,
  form: "10-K",
  filed: `${Number(end.slice(0, 4)) + 1}-02-01`,
  accn: `acc-${end}`,
  ...extra,
});

describe("extractAnnual", () => {
  const facts = {
    facts: {
      "us-gaap": {
        Revenues: { units: { USD: [fact("2023-12-31", 100), fact("2024-12-31", 120)] } },
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: { USD: [fact("2022-12-31", 80), fact("2024-12-31", 999)] },
        },
        NetIncomeLoss: {
          units: {
            USD: [
              fact("2024-12-31", 10, { filed: "2025-02-01" }),
              fact("2024-12-31", 11, { filed: "2025-06-01", accn: "restated" }), // restatement wins
              fact("2024-09-30", 3, { start: "2024-07-01" }), // a quarter: skipped
              fact("2023-12-31", 7, { form: "10-Q" }), // not annual
            ],
          },
        },
        Assets: {
          units: {
            USD: [{ end: "2024-12-31", val: 500, form: "10-K", filed: "2025-02-01", accn: "a1" }],
          },
        },
        EarningsPerShareDiluted: { units: { "USD/shares": [fact("2024-12-31", 1.23)] } },
      },
    },
  };

  it("reads annual flows and instants, keeps the latest filing per period and skips quarters and 10-Qs", () => {
    const out = extractAnnual(facts);
    const get = (metric: string, y: number) =>
      out.find((f) => f.metric === metric && f.fiscalYear === y);
    expect(get("revenue", 2024)!.value).toBe(120); // first tag in the list wins for a period
    expect(get("revenue", 2022)!.value).toBe(80); // a later tag fills years the first lacks
    expect(get("revenue", 2023)!.value).toBe(100);
    expect(get("net_income", 2024)).toMatchObject({ value: 11, accession: "restated" });
    expect(get("net_income", 2023)).toBeUndefined();
    expect(get("total_assets", 2024)!.value).toBe(500);
    expect(get("eps_diluted", 2024)).toMatchObject({ value: 1.23, unit: "USD/shares" });
    expect(get("equity", 2024)).toBeUndefined();
  });

  it("limits the number of years and rejects unexpected shapes", () => {
    expect(extractAnnual(facts, 1).filter((f) => f.metric === "revenue")).toHaveLength(1);
    expect(() => extractAnnual({ nope: 1 })).toThrow(/unexpected/);
    expect(extractAnnual({ facts: {} })).toEqual([]);
  });
});

function fakeEdgar(): EdgarClient {
  const e = new EdgarClient("test agent");
  e.submissions = async () => submissions;
  e.companyFacts = async () => ({
    facts: { "us-gaap": { Revenues: { units: { USD: [fact("2024-12-31", 120)] } } } },
  });
  return e;
}

describe("ingestEightKs", () => {
  it("stores each filing as a linked, rule-classified event, once, and skips companies without a CIK", async () => {
    const first = await ingestEightKs(ctx.db, fakeEdgar(), { since: "2026-01-01", delayMs: 0 });
    expect(first).toMatchObject({ companies: 1, articles: 1, skipped: 1, failed: [] });
    const again = await ingestEightKs(ctx.db, fakeEdgar(), { since: "2026-01-01", delayMs: 0 });
    expect(again.articles).toBe(0);

    const [a] = await ctx.db.select().from(newsArticles).where(eq(newsArticles.provider, "sec"));
    expect(a).toMatchObject({
      title: "Acme Corp files 8-K: Results of operations and financial condition (Item 2.02)",
      sourceName: "SEC EDGAR",
      marketSession: "after",
    });
    expect(a!.publishedAt.toISOString()).toBe("2026-05-04T20:15:00.000Z");
    expect(a!.url).toBe("https://www.sec.gov/Archives/edgar/data/123456/000126000003/a.htm");
    const [c] = await ctx.db
      .select()
      .from(newsClassifications)
      .where(eq(newsClassifications.articleId, a!.id));
    expect(c).toMatchObject({
      class: "fundamental",
      model: "sec-rules",
      confidence: 1,
      fundamentalImportance: 7,
    });
  });

  it("counts filings whose event type is not in the database instead of storing them", async () => {
    const s = await ingestEightKs(ctx.db, fakeEdgar(), { since: "2025-01-01", delayMs: 0 });
    expect(s).toMatchObject({ articles: 0, skipped: 1, missingType: { leadership_change: 1 } });
    await ctx.db.insert(eventTypes).values({
      slug: "leadership_change",
      name: "Leadership change",
      defaultClass: "fundamental",
      definition: "A director or officer joins or leaves.",
    });
    const again = await ingestEightKs(ctx.db, fakeEdgar(), { since: "2025-01-01", delayMs: 0 });
    expect(again).toMatchObject({ articles: 1, missingType: {} });
  });

  it("records a failing company and carries on", async () => {
    const bad = fakeEdgar();
    bad.submissions = async () => {
      throw new Error("boom");
    };
    const s = await ingestEightKs(ctx.db, bad, { since: "2026-01-01", delayMs: 0 });
    expect(s.failed).toEqual([{ ticker: "ACME", error: "boom" }]);
  });
});

describe("ingestFundamentals", () => {
  it("stores annual figures and updates them on a rerun", async () => {
    expect((await ingestFundamentals(ctx.db, fakeEdgar(), { delayMs: 0 })).companies).toBe(1);
    const e = fakeEdgar();
    e.companyFacts = async () => ({
      facts: {
        "us-gaap": {
          Revenues: { units: { USD: [fact("2024-12-31", 130, { filed: "2025-09-01" })] } },
        },
      },
    });
    await ingestFundamentals(ctx.db, e, { delayMs: 0 });
    const rows = await ctx.db
      .select()
      .from(fundamentals)
      .where(and(eq(fundamentals.metric, "revenue")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ value: 130, fiscalYear: 2024, unit: "USD" });
  });
});

describe("EdgarClient", () => {
  it("requires an identifying user agent", () => {
    expect(() => new EdgarClient("  ")).toThrow();
  });
});
