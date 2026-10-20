import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  companies,
  ingestFailures,
  newsArticles,
  newsCompanyLinks,
  pricesDaily,
} from "@portfolio-lab/db";
import { createTestDb } from "@portfolio-lab/db/testing";
import { seedDevCompanies } from "../../db/src/seed/companies";
import {
  FinnhubNewsProvider,
  MarketauxNewsProvider,
  ProviderError,
  canonicalUrl,
  eventTradingDate,
  ingestNews,
  jaccard,
  loadTradingDays,
  marketSession,
  normalizeTitle,
  shingles,
  titleHash,
  type NewsProvider,
  type RawArticle,
} from "./index";

const resp = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("normalize", () => {
  it("canonicalizes urls", () => {
    expect(canonicalUrl("https://WWW.Example.com/a/b/?utm_source=x&b=2&a=1#frag")).toBe(
      "https://example.com/a/b?a=1&b=2",
    );
    expect(canonicalUrl("https://example.com/")).toBe("https://example.com/");
    expect(canonicalUrl("not a url")).toBe("not a url");
  });

  it("hashes titles independent of case, punctuation, accents and a source suffix", () => {
    const a = titleHash("Acme Corp. cuts outlook - Reuters");
    expect(titleHash("ACME CORP CUTS OUTLOOK")).toBe(a);
    expect(titleHash("Acme Corp: cuts outlook!")).toBe(a);
    expect(titleHash("Acmé Corp cuts outlook | Bloomberg")).toBe(a);
    expect(titleHash("Acme Corp raises outlook")).not.toBe(a);
  });

  it("normalizes whitespace and keeps meaningful dashes inside the title", () => {
    expect(normalizeTitle("  Hello,   World  ")).toBe("hello world");
    expect(normalizeTitle("Rate cut - what it means for banks and borrowers today")).toContain(
      "what it means",
    );
  });

  it("scores near duplicates above the threshold and different stories below", () => {
    const a = shingles("Acme Semiconductor cuts full-year revenue outlook on weak orders");
    const b = shingles(
      "Acme Semiconductor cuts full year revenue outlook on weak orders - Reuters",
    );
    const c = shingles("Borealis Motors recalls SUVs over brake fault");
    expect(jaccard(a, b)).toBeGreaterThanOrEqual(0.8);
    expect(jaccard(a, c)).toBeLessThan(0.2);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
});

describe("marketSession", () => {
  it("handles winter (EST) boundaries", () => {
    // Thursday 2026-01-15; 09:30 EST = 14:30Z
    expect(marketSession(new Date("2026-01-15T14:29:00Z"))).toBe("pre");
    expect(marketSession(new Date("2026-01-15T14:30:00Z"))).toBe("regular");
    expect(marketSession(new Date("2026-01-15T20:59:00Z"))).toBe("regular");
    expect(marketSession(new Date("2026-01-15T21:00:00Z"))).toBe("after");
    expect(marketSession(new Date("2026-01-16T01:00:00Z"))).toBe("closed");
    expect(marketSession(new Date("2026-01-15T08:59:00Z"))).toBe("closed");
  });

  it("handles summer (EDT) boundaries", () => {
    // Wednesday 2026-07-15; 09:30 EDT = 13:30Z
    expect(marketSession(new Date("2026-07-15T13:29:00Z"))).toBe("pre");
    expect(marketSession(new Date("2026-07-15T13:30:00Z"))).toBe("regular");
    expect(marketSession(new Date("2026-07-15T20:00:00Z"))).toBe("after");
  });

  it("follows the DST change on 2026-03-08", () => {
    expect(marketSession(new Date("2026-03-06T14:30:00Z"))).toBe("regular"); // Friday, EST
    expect(marketSession(new Date("2026-03-09T13:30:00Z"))).toBe("regular"); // Monday, EDT
    expect(marketSession(new Date("2026-03-09T14:30:00Z"))).toBe("regular");
  });

  it("is closed on weekends", () => {
    expect(marketSession(new Date("2026-07-18T15:00:00Z"))).toBe("closed");
    expect(marketSession(new Date("2026-07-19T15:00:00Z"))).toBe("closed");
  });
});

describe("eventTradingDate", () => {
  it("uses the same day for pre-market and regular-session news", () => {
    expect(eventTradingDate(new Date("2026-07-15T12:00:00Z"))).toBe("2026-07-15");
    expect(eventTradingDate(new Date("2026-07-15T15:00:00Z"))).toBe("2026-07-15");
  });

  it("rolls after-hours and overnight news to the next trading day, skipping weekends", () => {
    expect(eventTradingDate(new Date("2026-07-15T21:00:00Z"))).toBe("2026-07-16");
    expect(eventTradingDate(new Date("2026-07-17T21:00:00Z"))).toBe("2026-07-20"); // Friday evening
    expect(eventTradingDate(new Date("2026-07-18T15:00:00Z"))).toBe("2026-07-20"); // Saturday
  });

  it("uses the Eastern date, not the UTC date, for late evening news", () => {
    // 2026-07-15 23:30 EDT = 2026-07-16 03:30Z
    expect(eventTradingDate(new Date("2026-07-16T03:30:00Z"))).toBe("2026-07-16");
  });

  it("respects a holiday predicate and cannot loop forever", () => {
    const holiday = (d: string) =>
      d !== "2026-07-15" && new Date(`${d}T00:00:00Z`).getUTCDay() % 6 !== 0;
    expect(eventTradingDate(new Date("2026-07-15T15:00:00Z"), holiday)).toBe("2026-07-16");
    expect(eventTradingDate(new Date("2026-07-15T15:00:00Z"), () => false)).toBeTypeOf("string");
  });
});

describe("news adapters", () => {
  it("parses Finnhub rows, converting unix time and related tickers, and skips empty headlines", async () => {
    const fetchImpl = (async () =>
      resp([
        {
          id: 1,
          datetime: 1_768_487_400,
          headline: " Acme cuts outlook ",
          summary: "Weak orders",
          source: "Wire",
          url: "https://x.com/a",
          related: "nvda, aapl",
        },
        { id: 2, datetime: 1_768_487_400, headline: "  ", url: "https://x.com/b" },
      ])) as typeof fetch;
    const out = await new FinnhubNewsProvider("k", { fetchImpl }).getCompanyNews(
      "NVDA",
      "2026-01-01",
      "2026-01-31",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      providerId: "1",
      title: "Acme cuts outlook",
      snippet: "Weak orders",
      tickers: ["NVDA", "AAPL"],
    });
    expect(out[0]!.publishedAt.toISOString()).toBe("2026-01-15T14:30:00.000Z");
  });

  it("parses Marketaux rows and skips malformed ones", async () => {
    const fetchImpl = (async () =>
      resp({
        data: [
          {
            uuid: "u1",
            title: "Acme beats",
            description: "Strong quarter",
            url: "https://x.com/a",
            published_at: "2026-01-15T14:30:00.000000Z",
            source: "x.com",
            entities: [{ symbol: "NVDA" }, { symbol: null }],
          },
          { uuid: "u2", title: "Bad date", url: "https://x.com/b", published_at: "not a date" },
          { nope: true },
        ],
      })) as typeof fetch;
    const out = await new MarketauxNewsProvider("k", { fetchImpl }).getCompanyNews(
      "NVDA",
      "2026-01-01",
      "2026-01-31",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      providerId: "u1",
      snippet: "Strong quarter",
      tickers: ["NVDA"],
    });
  });

  it("throws bad_response on an unexpected shape", async () => {
    const fetchImpl = (async () => resp({ error: "x" })) as typeof fetch;
    await expect(
      new FinnhubNewsProvider("k", { fetchImpl }).getCompanyNews("X", "2026-01-01", "2026-01-02"),
    ).rejects.toBeInstanceOf(ProviderError);
    await expect(
      new MarketauxNewsProvider("k", { fetchImpl }).getCompanyNews("X", "2026-01-01", "2026-01-02"),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("ingestNews", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    ctx = await createTestDb();
    await seedDevCompanies(ctx.db);
  });
  afterAll(async () => {
    await ctx.teardown();
  });

  const art = (id: string, title: string, at: string, tickers: string[] = []): RawArticle => ({
    providerId: id,
    url: `https://news.example.com/${id}?utm_source=feed`,
    title,
    publishedAt: new Date(at),
    tickers,
  });
  const providerOf = (byTicker: Record<string, RawArticle[] | Error>): NewsProvider => ({
    name: "fake",
    async getCompanyNews(ticker) {
      const r = byTicker[ticker];
      if (r instanceof Error) throw r;
      return r ?? [];
    },
  });
  const range = { from: "2026-07-01", to: "2026-07-31" };

  it("stores articles with canonical url, session and provider-tag links, ignoring unknown tickers", async () => {
    const p = providerOf({
      NVDA: [
        art(
          "a1",
          "Acme Semiconductor cuts revenue outlook on weak orders",
          "2026-07-15T15:00:00Z",
          ["NVDA", "ZZZZ", "AAPL"],
        ),
      ],
    });
    const s = await ingestNews(ctx.db, p, ["NVDA"], range);
    expect(s).toMatchObject({ fetched: 1, inserted: 1, duplicates: 0, links: 2 });
    const [row] = await ctx.db.select().from(newsArticles).where(eq(newsArticles.providerId, "a1"));
    expect(row).toMatchObject({ url: "https://news.example.com/a1", marketSession: "regular" });
    expect(row!.clusterId).toBe(row!.id);
    const links = await ctx.db
      .select()
      .from(newsCompanyLinks)
      .where(eq(newsCompanyLinks.articleId, row!.id));
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.method === "provider_tag")).toBe(true);
  });

  it("is idempotent", async () => {
    const p = providerOf({
      NVDA: [
        art(
          "a1",
          "Acme Semiconductor cuts revenue outlook on weak orders",
          "2026-07-15T15:00:00Z",
          ["NVDA", "AAPL"],
        ),
      ],
    });
    const s = await ingestNews(ctx.db, p, ["NVDA"], range);
    expect(s).toMatchObject({ inserted: 0, duplicates: 1, links: 0 });
    expect(await ctx.db.select().from(newsArticles)).toHaveLength(1);
  });

  it("adds a link when a second ticker query returns an article already stored", async () => {
    const p = providerOf({
      MSFT: [
        art("a1", "Acme Semiconductor cuts revenue outlook on weak orders", "2026-07-15T15:00:00Z"),
      ],
    });
    const s = await ingestNews(ctx.db, p, ["MSFT"], range);
    expect(s).toMatchObject({ inserted: 0, duplicates: 1, links: 1 });
  });

  it("clusters syndicated copies and keeps unrelated stories apart", async () => {
    const p = providerOf({
      AAPL: [
        art(
          "b1",
          "Acme Semiconductor cuts revenue outlook on weak orders - Reuters",
          "2026-07-15T18:00:00Z",
        ),
        art("b2", "Borealis Motors recalls SUVs over brake fault", "2026-07-15T18:05:00Z"),
        art("b3", "Acme Semiconductor cuts revenue outlook on weak orders", "2026-07-25T18:00:00Z"),
      ],
    });
    const s = await ingestNews(ctx.db, p, ["AAPL"], range);
    expect(s).toMatchObject({ inserted: 3, clustered: 1 });
    const rows = await ctx.db.select().from(newsArticles);
    const by = Object.fromEntries(rows.map((r) => [r.providerId, r]));
    expect(by.b1!.clusterId).toBe(by.a1!.id);
    expect(by.b2!.clusterId).toBe(by.b2!.id);
    expect(by.b3!.clusterId).toBe(by.b3!.id); // same title but 10 days later: a new event
  });

  it("records a failing ticker in the dead-letter table and continues", async () => {
    const p = providerOf({
      JPM: new ProviderError("fake", "not found", "not_found"),
      AMZN: [art("c1", "Amazon announces new fulfilment hub", "2026-07-16T15:00:00Z")],
    });
    const s = await ingestNews(ctx.db, p, ["JPM", "AMZN"], range);
    expect(s.failures).toEqual([{ ticker: "JPM", error: "fake: not found" }]);
    expect(s.inserted).toBe(1);
    const dead = await ctx.db.select().from(ingestFailures);
    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({ provider: "fake", subject: "JPM" });
  });

  it("stops on rate limiting and reports the unprocessed tickers", async () => {
    const p = providerOf({
      NVDA: [],
      AAPL: new ProviderError("fake", "429", "rate_limited"),
      MSFT: [],
    });
    const s = await ingestNews(ctx.db, p, ["NVDA", "AAPL", "MSFT"], range);
    expect(s.stoppedEarly).toBe("rate_limited");
    expect(s.remaining).toEqual(["AAPL", "MSFT"]);
  });

  it("paces requests with the delay", async () => {
    const sleeps: number[] = [];
    await ingestNews(ctx.db, providerOf({}), ["NVDA", "AAPL", "MSFT"], range, {
      delayMs: 25,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(sleeps).toEqual([25, 25]);
  });

  it("knows the seeded companies", async () => {
    expect((await ctx.db.select().from(companies)).length).toBe(5);
  });
});

describe("loadTradingDays", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    ctx = await createTestDb();
    await seedDevCompanies(ctx.db);
    const [c] = await ctx.db.select().from(companies).where(eq(companies.ticker, "NVDA"));
    // 2026-07-03 (Friday) is the observed Independence Day holiday, so it has no bar; 2026-07-06 is a Monday.
    const dates = ["2026-06-30", "2026-07-01", "2026-07-02", "2026-07-06", "2026-07-07"];
    await ctx.db
      .insert(pricesDaily)
      .values(dates.map((date) => ({ companyId: c!.id, date, close: 1, adjClose: 1 })));
  });
  afterAll(async () => {
    await ctx.teardown();
  });

  it("treats a weekday without bars inside the loaded range as a holiday and rolls news past it", async () => {
    const isTrading = await loadTradingDays(ctx.db, "2026-06-01", "2026-07-31");
    expect(isTrading("2026-07-02")).toBe(true);
    expect(isTrading("2026-07-03")).toBe(false);
    // After-hours Thursday news: the next trading day is Monday, not the Friday holiday.
    expect(eventTradingDate(new Date("2026-07-02T21:00:00Z"), isTrading)).toBe("2026-07-06");
    // Pre-market news on the holiday itself also lands on Monday.
    expect(eventTradingDate(new Date("2026-07-03T12:00:00Z"), isTrading)).toBe("2026-07-06");
  });

  it("falls back to the weekday rule outside the loaded range, and when there are no bars at all", async () => {
    const isTrading = await loadTradingDays(ctx.db, "2026-06-01", "2026-07-31");
    expect(isTrading("2026-07-15")).toBe(true); // after the last bar: unknown, weekday
    expect(isTrading("2026-07-18")).toBe(false); // Saturday
    expect(isTrading("2026-05-01")).toBe(true); // before the first bar
    const empty = await loadTradingDays(ctx.db, "2020-01-01", "2020-01-31");
    expect(empty("2020-01-01")).toBe(true);
    expect(empty("2020-01-04")).toBe(false);
  });
});
