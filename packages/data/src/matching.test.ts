import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { companies, newsArticles, newsCompanyLinks } from "@portfolio-lab/db";
import { createTestDb } from "@portfolio-lab/db/testing";
import {
  AliasIndex,
  MIN_LINK_SCORE,
  generateAliases,
  loadAliasIndex,
  loadConstituents,
  matchArticles,
  syncAliases,
  type Constituent,
} from "./index";

describe("generateAliases", () => {
  const names = (n: string) => generateAliases(n).map((a) => a.alias);

  it("strips legal suffixes, share-class notes and a leading The", () => {
    expect(names("Apple Inc.")).toEqual(["Apple"]);
    expect(names("Alphabet Inc. (Class A)")).toEqual(["Alphabet"]);
    expect(names("Coca-Cola Company (The)")).toEqual(["Coca-Cola"]);
    expect(names("Advanced Micro Devices")).toEqual(["Advanced Micro Devices"]);
    expect(names("JPMorgan Chase & Co.")).toEqual(["JPMorgan Chase"]);
  });

  it("adds an 'and' variant for ampersand names", () => {
    expect(names("Johnson & Johnson")).toEqual(["Johnson & Johnson", "Johnson and Johnson"]);
  });

  it("flags only single-word ambiguous names", () => {
    expect(generateAliases("Target Corporation")[0]).toMatchObject({
      alias: "Target",
      ambiguous: true,
    });
    expect(generateAliases("Apple Inc.")[0]!.ambiguous).toBe(false);
  });
});

describe("AliasIndex", () => {
  const index = new AliasIndex(
    [
      { companyId: 1, alias: "Advanced Micro Devices", ambiguous: false },
      { companyId: 2, alias: "Advanced Auto Parts", ambiguous: false },
      { companyId: 3, alias: "Apple", ambiguous: false },
      { companyId: 4, alias: "Fox", ambiguous: true },
      { companyId: 5, alias: "3M", ambiguous: false },
      { companyId: 6, alias: "AES", ambiguous: false },
    ],
    [
      { companyId: 1, ticker: "AMD" },
      { companyId: 3, ticker: "AAPL" },
      { companyId: 7, ticker: "T" },
      { companyId: 8, ticker: "IT" },
    ],
  );
  const m = (title: string, extra: { snippet?: string; body?: string } = {}) =>
    index.match({ title, ...extra });

  it("prefers the longest alias and does not match shorter prefixes of other names", () => {
    expect(m("Advanced Micro Devices unveils chip").map((x) => x.companyId)).toEqual([1]);
  });

  it("handles possessives and surrounding punctuation", () => {
    expect(m("Apple's new device, analysts say").map((x) => x.companyId)).toEqual([3]);
  });

  it("requires a capitalized start for ordinary aliases and exact case for all-caps ones", () => {
    expect(m("apple pie recipe")).toEqual([]);
    expect(m("Aes of spades")).toEqual([]);
    expect(m("AES raises outlook").map((x) => x.companyId)).toEqual([6]);
    expect(m("3M settles suit").map((x) => x.companyId)).toEqual([5]);
  });

  it("scores single words, ambiguous words and multi-word names differently", () => {
    expect(m("Apple rises")[0]!.score).toBeCloseTo(0.8, 12);
    expect(m("Fox hunting banned")[0]!.score).toBeCloseTo(0.3, 12);
    expect(m("Advanced Micro Devices rises")[0]!.score).toBeCloseTo(0.9, 12);
    expect(0.3).toBeLessThan(MIN_LINK_SCORE);
  });

  it("matches cashtags and exchange-qualified tickers, and ignores unknown symbols", () => {
    expect(m("Why $AAPL fell")[0]).toMatchObject({ companyId: 3, score: 0.95 });
    expect(m("Chipmaker (NASDAQ: AMD) rises")[0]).toMatchObject({ companyId: 1 });
    expect(m("Carrier (NYSE: T) rises")[0]).toMatchObject({ companyId: 7 });
    expect(m("Fund ($ZZZZ) rises")).toEqual([]);
  });

  it("does not match bare tickers or single-letter parenthesized markers", () => {
    expect(m("IT spending rises")).toEqual([]);
    expect(m("Section (T) applies")).toEqual([]);
    expect(m("Chipmaker (AMD) rises")[0]!.companyId).toBe(1);
  });

  it("combines independent evidence with a noisy-or, capped below 1", () => {
    const r = m("Apple (AAPL) rises")[0]!;
    expect(r.score).toBeCloseTo(1 - 0.2 * 0.05, 12);
    expect(r.evidence).toEqual(["(AAPL)", "Apple"]);
    expect(m("Apple $AAPL (NASDAQ: AAPL)")[0]!.score).toBeLessThanOrEqual(0.99);
  });

  it("weights fields: a body-only mention is weaker than a title mention", () => {
    expect(m("Markets close", { body: "Shares of Apple rose." })[0]!.score).toBeCloseTo(
      0.8 * 0.7,
      12,
    );
    expect(m("Markets close", { snippet: "Apple rose." })[0]!.score).toBeCloseTo(0.8 * 0.9, 12);
    expect(m("Apple rose", { body: "Apple rose." })[0]!.score).toBeCloseTo(0.8, 12);
  });

  it("returns nothing for empty text", () => {
    expect(index.match({})).toEqual([]);
    expect(index.match({ title: "" })).toEqual([]);
  });
});

describe("matching against the real S&P 500 names", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let index: AliasIndex;
  let idOf: Map<string, number>;
  beforeAll(async () => {
    ctx = await createTestDb();
    const dir = fileURLToPath(new URL("../snapshots/", import.meta.url));
    const file = readdirSync(dir)
      .filter((f) => f.startsWith("sp500-"))
      .sort()
      .at(-1)!;
    await loadConstituents(
      ctx.db,
      JSON.parse(readFileSync(`${dir}${file}`, "utf8")) as Constituent[],
    );
    await syncAliases(ctx.db);
    index = await loadAliasIndex(ctx.db);
    idOf = new Map((await ctx.db.select().from(companies)).map((c) => [c.ticker, c.id]));
  });
  afterAll(async () => {
    await ctx.teardown();
  });

  const strong = (text: string) =>
    index
      .match({ title: text })
      .filter((x) => x.score >= MIN_LINK_SCORE)
      .map((x) => [...idOf.entries()].find(([, id]) => id === x.companyId)![0])
      .sort();

  // Fixtures are invented headlines used only to measure matching behavior.
  const labeled: [string, string[]][] = [
    ["Nvidia and Microsoft expand cloud partnership", ["MSFT", "NVDA"]],
    ["Apple's new device draws crowds", ["AAPL"]],
    ["Advanced Micro Devices unveils new chip", ["AMD"]],
    ["Johnson & Johnson to buy device maker", ["JNJ"]],
    ["AT&T raises dividend", ["T"]],
    ["Coca-Cola reports quarterly results", ["KO"]],
    ["Why $TSLA fell on Tuesday", ["TSLA"]],
    ["Walt Disney (NYSE: DIS) announces streaming changes", ["DIS"]],
    ["JPMorgan Chase warns on rates", ["JPM"]],
    ["Amazon expands same-day delivery", ["AMZN"]],
    ["Alphabet unit launches new product", ["GOOG", "GOOGL"]],
    ["3M settles lawsuit over earplugs", ["MMM"]],
    ["Target cuts forecast as shoppers pull back", []],
    ["Fox hunting banned in county", []],
    ["Visa requirements eased for tourists", []],
    ["apple pie recipe goes viral", []],
    ["IT spending rises as budgets recover", []],
    ["Section (A) of the bill is amended", []],
    ["European airline names new chief executive", []],
  ];

  it.each(labeled)("%s", (text, expected) => {
    expect(strong(text)).toEqual(expected);
  });

  it("documents a known false positive: a geographic use of a company name", () => {
    expect(strong("The Amazon river basin floods after heavy rain")).toEqual(["AMZN"]);
  });

  it("loads aliases idempotently", async () => {
    const before = (await syncAliases(ctx.db)) as number;
    expect(await syncAliases(ctx.db)).toBe(before);
  });

  it("writes alias links, replaces them on re-run, and leaves provider-tag links alone", async () => {
    const [a] = await ctx.db
      .insert(newsArticles)
      .values({
        provider: "t",
        providerId: "m1",
        url: "http://x",
        title: "Nvidia and Microsoft expand partnership",
        publishedAt: new Date(),
        dedupeHash: "h1",
      })
      .returning();
    await ctx.db
      .insert(newsCompanyLinks)
      .values({ articleId: a!.id, companyId: idOf.get("AAPL")!, method: "provider_tag", score: 1 });

    expect(await matchArticles(ctx.db, index)).toBe(2);
    expect(await matchArticles(ctx.db, index)).toBe(0); // already matched, skipped when ids are omitted
    expect(await matchArticles(ctx.db, index, [a!.id])).toBe(2); // explicit re-run replaces

    const links = await ctx.db
      .select()
      .from(newsCompanyLinks)
      .where(eq(newsCompanyLinks.articleId, a!.id));
    expect(links.filter((l) => l.method === "alias")).toHaveLength(2);
    expect(links.filter((l) => l.method === "provider_tag")).toHaveLength(1);
    const nvda = links.find((l) => l.companyId === idOf.get("NVDA") && l.method === "alias")!;
    expect(nvda.score).toBeCloseTo(0.8, 12);
    expect(
      await ctx.db
        .select()
        .from(newsCompanyLinks)
        .where(and(eq(newsCompanyLinks.articleId, a!.id), eq(newsCompanyLinks.method, "alias"))),
    ).toHaveLength(2);
  });
});
