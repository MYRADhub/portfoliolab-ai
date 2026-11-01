import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  benchmarkPrices,
  companies,
  companyFactorExposures,
  factors,
  fundamentals,
  holdings,
  newsArticles,
  newsCompanyLinks,
  portfolios,
  pricesDaily,
  sessions,
} from "@portfolio-lab/db";
import { createTestDb } from "@portfolio-lab/db/testing";
import type {
  AssistantModel,
  AssistantTool,
  AssistantTurn,
  ToolEntry,
  ToolOutput,
  WebSearcher,
} from "@portfolio-lab/explain";
import { AppError } from "./errors";
import {
  deleteThread,
  executeResearch,
  getThread,
  listThreads,
  prepareResearch,
  titleFrom,
  verifiedTurns,
  type ChatMessage,
} from "./research-chat";
import { buildResearchTools, type EdgarLike } from "./research-tools";
import { deckInputFrom, getDeck, makeDeck } from "./research-deck";
import type { DeckGenerator } from "@portfolio-lab/explain";
import { RateLimiter } from "./rate-limit";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let sid: string;
let other: string;
let pid: string;
const now = new Date("2026-10-30T20:00:00Z");

const day = (i: number) =>
  new Date(Date.UTC(2025, 9, 1) + i * 86_400_000).toISOString().slice(0, 10);
const DAYS = 395; // 2025-10-01 .. 2026-10-30

beforeAll(async () => {
  ctx = await createTestDb();
  const s = await ctx.db.insert(sessions).values([{}, {}]).returning();
  sid = s[0]!.id;
  other = s[1]!.id;
  const cs = await ctx.db
    .insert(companies)
    .values([
      {
        ticker: "AAA",
        name: "Alpha Chips",
        sector: "Information Technology",
        industry: "Semis",
        cik: "0000000001",
      },
      { ticker: "BBB", name: "Beta Banks", sector: "Financials", cik: "0000000002" },
      { ticker: "CCC", name: "Gamma Grids", sector: "Utilities" },
    ])
    .returning();
  const [a, b, c] = cs;
  // AAA doubles in a straight line, BBB is flat, CCC falls 20%.
  const rows = [];
  for (let i = 0; i < DAYS; i++) {
    const d = day(i);
    const t = i / (DAYS - 1);
    rows.push(
      { companyId: a!.id, date: d, close: 1, adjClose: 100 * (1 + t) * (1 + 0.01 * Math.sin(i)) },
      { companyId: b!.id, date: d, close: 1, adjClose: 50 * (1 + 0.005 * Math.cos(i)) },
      { companyId: c!.id, date: d, close: 1, adjClose: 40 * (1 - 0.2 * t) },
    );
  }
  await ctx.db.insert(pricesDaily).values(rows);
  await ctx.db.insert(benchmarkPrices).values(
    Array.from({ length: DAYS }, (_, i) => ({
      symbol: "SPY",
      date: day(i),
      adjClose: 500 * (1 + 0.1 * (i / (DAYS - 1))),
    })),
  );
  const f = (companyId: number, metric: string, fiscalYear: number, value: number) => ({
    companyId,
    metric,
    fiscalYear,
    value,
    periodEnd: `${fiscalYear}-12-31`,
    unit: "USD",
    filedAt: `${fiscalYear + 1}-02-20`,
    accession: `acc-${companyId}-${fiscalYear}`,
  });
  await ctx.db
    .insert(fundamentals)
    .values([
      f(a!.id, "revenue", 2025, 200e9),
      f(a!.id, "revenue", 2024, 100e9),
      f(a!.id, "net_income", 2025, 100e9),
      f(a!.id, "eps_diluted", 2025, 4),
      f(b!.id, "revenue", 2025, 50e9),
      f(b!.id, "revenue", 2024, 50e9),
      f(b!.id, "net_income", 2025, 5e9),
      f(b!.id, "eps_diluted", 2025, 5),
    ]);
  const [ai, rates] = await ctx.db
    .insert(factors)
    .values([
      {
        slug: "ai_capex",
        name: "AI capital spending",
        category: "theme",
        description: "Spending on AI data centers.",
      },
      { slug: "rates", name: "Interest rates", category: "macro", description: "Level of rates." },
    ])
    .returning();
  const e = (companyId: number, factorId: number, magnitude: number, direction: number) => ({
    companyId,
    factorId,
    magnitude,
    direction,
    confidence: 0.8,
    source: "manual" as const,
    rationale: "test",
  });
  await ctx.db
    .insert(companyFactorExposures)
    .values([e(a!.id, ai!.id, 3, 1), e(b!.id, rates!.id, 2, 1), e(c!.id, rates!.id, 2, -1)]);
  const [n1, n2] = await ctx.db
    .insert(newsArticles)
    .values([
      {
        provider: "t",
        providerId: "1",
        url: "https://news.test/1",
        title: "Alpha Chips beats on data center demand",
        publishedAt: new Date("2026-10-20T12:00:00Z"),
        dedupeHash: "h1",
      },
      {
        provider: "t",
        providerId: "2",
        url: "https://news.test/2",
        title: "Banks rally as rates hold",
        publishedAt: new Date("2026-10-25T12:00:00Z"),
        dedupeHash: "h2",
      },
    ])
    .returning();
  await ctx.db.insert(newsCompanyLinks).values([
    { articleId: n1!.id, companyId: a!.id, method: "alias", score: 1 },
    { articleId: n2!.id, companyId: b!.id, method: "alias", score: 1 },
  ]);
  const [p] = await ctx.db.insert(portfolios).values({ sessionId: sid, name: "Mine" }).returning();
  pid = p!.id;
  await ctx.db.insert(holdings).values([
    { portfolioId: pid, companyId: a!.id, weight: 0.6 },
    { portfolioId: pid, companyId: b!.id, weight: 0.4 },
  ]);
});
afterAll(async () => {
  await ctx.teardown();
});

const base = () => ({ db: ctx.db, sessionId: sid, portfolioId: null, now, web: null, edgar: null });
const tool = (tools: AssistantTool[], name: string) => {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};
const out = (r: ToolEntry[] | ToolOutput): ToolOutput => (Array.isArray(r) ? { entries: r } : r);
const text = (r: ToolOutput, label: string) => r.entries.find((e) => e.label === label)?.text;

describe("research tools", () => {
  it("offers web, SEC and portfolio tools only when they are configured", () => {
    const names = buildResearchTools(base()).map((t) => t.name);
    expect(names).toEqual([
      "find_companies",
      "get_company",
      "get_fundamentals",
      "price_history",
      "compare_companies",
      "screen_companies",
      "list_factors",
      "search_news",
    ]);
    const web: WebSearcher = { search: async () => [], open: async () => [] };
    const edgar = {} as EdgarLike;
    const all = buildResearchTools({ ...base(), portfolioId: pid, web, edgar }).map((t) => t.name);
    expect(all).toEqual(
      expect.arrayContaining([
        "get_holdings",
        "get_portfolio_summary",
        "get_portfolio_news",
        "what_if_add",
        "web_search",
        "read_web_page",
        "list_filings",
        "read_filing",
        "search_filings",
      ]),
    );
    expect(all.filter((n) => n === "get_company")).toHaveLength(1);
  });

  it("finds companies by name and validates tickers", async () => {
    const t = buildResearchTools(base());
    const r = out(await tool(t, "find_companies").run({ query: "beta" }));
    expect(r.entries).toEqual([{ label: "Company BBB", text: "Beta Banks (Financials)" }]);
    await expect(tool(t, "get_company").run({ ticker: "bad ticker!" })).rejects.toThrow(
      /stock ticker/,
    );
  });

  it("profiles a company with ratios, exposures and peers", async () => {
    const r = out(await tool(buildResearchTools(base()), "get_company").run({ ticker: "aaa" }));
    expect(text(r, "AAA sector")).toBe("Information Technology, Semis");
    expect(text(r, "AAA revenue growth, fiscal 2025")).toBe("+100.0%");
    expect(text(r, "AAA net margin, fiscal 2025")).toBe("50.0%");
    expect(text(r, "AAA exposure to AI capital spending")).toBe("+3 on a scale of -3 to 3: test");
    expect(r.entries.some((e) => e.label.startsWith("AAA closest peers"))).toBe(true);
  });

  it("gives annual figures with a table, oldest year first", async () => {
    const r = out(
      await tool(buildResearchTools(base()), "get_fundamentals").run({ ticker: "AAA" }),
    );
    expect(text(r, "AAA revenue, fiscal 2025")).toBe("$200.0B");
    expect(text(r, "AAA diluted EPS, fiscal 2025")).toBe("$4.00");
    expect(r.displays![0]).toMatchObject({
      kind: "table",
      columns: ["Metric", "FY2024", "FY2025"],
    });
    const none = out(
      await tool(buildResearchTools(base()), "get_fundamentals").run({ ticker: "CCC" }),
    );
    expect(none.entries[0]!.text).toBe("not loaded for this company");
  });

  it("compares price history with SPY: returns, gap, correlation and an indexed chart", async () => {
    const r = out(
      await tool(buildResearchTools(base()), "price_history").run({
        tickers: ["CCC", "SPY", "ZZZ"],
        period: "1y",
      }),
    );
    expect(text(r, "ZZZ price history")).toBe("not in our data");
    const ccc = text(r, "CCC return, 1 year")!;
    expect(ccc).toMatch(/^-1\d\.\d%/);
    const gap = r.entries.find((e) => e.label.startsWith("Return gap, CCC minus SPY"));
    expect(gap!.text).toMatch(/^-2\d\.\d percentage points$/);
    expect(
      r.entries.some((e) => e.label.startsWith("Correlation of daily returns, CCC and SPY")),
    ).toBe(true);
    expect(r.display).toMatchObject({ kind: "line", unit: "index" });
    const series = r.display!.kind === "line" ? r.display!.series : [];
    expect(series.map((s) => s.name)).toEqual(["CCC", "SPY"]);
    expect(series[0]!.points[0]!.value).toBe(100);
    expect(series[0]!.points.length).toBeLessThanOrEqual(261);
  });

  it("compares companies side by side and marks unknown ones", async () => {
    const r = out(
      await tool(buildResearchTools(base()), "compare_companies").run({
        tickers: ["AAA", "BBB", "QQQQ"],
      }),
    );
    expect(text(r, "AAA (Information Technology) snapshot")).toContain("P/E");
    expect(text(r, "QQQQ snapshot")).toBe("not in our data");
    expect(r.displays![0]!.kind === "table" && r.displays![0]!.rows.length).toBe(3);
    await expect(
      tool(buildResearchTools(base()), "compare_companies").run({ tickers: ["AAA"] }),
    ).rejects.toThrow(/2 to 6/);
  });

  it("screens by sector, factor direction and ranges, and sorts", async () => {
    const t = tool(buildResearchTools(base()), "screen_companies");
    const byRates = out(await t.run({ factor: "rates", factor_direction: "negative" }));
    expect(byRates.entries[0]!.text).toMatch(/^1 of 3 companies match/);
    expect(byRates.entries[1]!.label).toBe("CCC Gamma Grids (Utilities)");
    const winners = out(await t.run({ min_return_1y: 50, sort_by: "return_1y" }));
    expect(winners.entries.slice(1).map((e) => e.label.split(" ")[0])).toEqual(["AAA"]);
    const cheap = out(await t.run({ max_pe: 15, sort_by: "pe", order: "asc" }));
    expect(cheap.entries.slice(1).map((e) => e.label.split(" ")[0])).toEqual(["BBB"]);
    const sector = out(await t.run({ sector: "util" }));
    expect(sector.entries[0]!.text).toMatch(/^1 of 3/);
    await expect(t.run({ factor: "nope" })).rejects.toThrow(/list_factors/);
  });

  it("lists factors with exposure counts", async () => {
    const r = out(await tool(buildResearchTools(base()), "list_factors").run({}));
    expect(text(r, "Factor rates")).toMatch(/^Interest rates \(macro\), 2 companies exposed/);
  });

  it("searches news by ticker and by words, with links", async () => {
    const t = tool(buildResearchTools(base()), "search_news");
    const byTicker = out(await t.run({ ticker: "AAA", days: 30 }));
    expect(byTicker.entries).toEqual([
      {
        label: "Headline, 2026-10-20",
        text: "Alpha Chips beats on data center demand",
        source: {
          url: "https://news.test/1",
          title: "Alpha Chips beats on data center demand",
          published: "2026-10-20",
        },
      },
    ]);
    const byWords = out(await t.run({ query: "rates hold" }));
    expect(byWords.entries.map((e) => e.text)).toEqual(["Banks rally as rates hold"]);
    const old = out(await t.run({ query: "rally", days: 1 }));
    expect(old.entries[0]!.text).toBe("no headlines in the last 1 days");
    await expect(t.run({})).rejects.toThrow(/ticker, a query/);
  });

  it("lists portfolio holdings by weight", async () => {
    const r = out(
      await tool(buildResearchTools({ ...base(), portfolioId: pid }), "get_holdings").run({}),
    );
    expect(r.entries.map((e) => e.label)).toEqual(["Portfolio name", "Holding AAA", "Holding BBB"]);
  });

  it("turns web results into web facts with sources, and validates URLs", async () => {
    const web: WebSearcher = {
      search: async (q) => [
        {
          title: "Result",
          url: "https://ex.com/a",
          snippet: `About ${q}: revenue was $5.0 billion.`,
          published: "2 days ago",
        },
      ],
      open: async () => [],
    };
    const t = buildResearchTools({ ...base(), web });
    const r = out(await tool(t, "web_search").run({ query: "alpha" }));
    expect(r.entries).toEqual([
      {
        label: "Result (ex.com, 2 days ago)",
        text: "About alpha: revenue was $5.0 billion.",
        kind: "web",
        source: { url: "https://ex.com/a", title: "Result", published: "2 days ago" },
      },
    ]);
    const empty = out(await tool(t, "read_web_page").run({ url: "https://ex.com/b" }));
    expect(empty.entries[0]!.text).toBe("could not be read");
    await expect(tool(t, "read_web_page").run({ url: "file:///etc/passwd" })).rejects.toThrow(
      /http/,
    );
  });

  describe("SEC tools", () => {
    const words = (n: number, w: string) => Array.from({ length: n }, () => w).join(" ");
    const submissions = {
      filings: {
        recent: {
          accessionNumber: ["0000000001-26-000009", "0000000001-26-000005"],
          filingDate: ["2026-10-01", "2026-02-20"],
          form: ["8-K", "10-K"],
          primaryDocument: ["e.htm", "k.htm"],
          reportDate: ["", "2025-12-31"],
        },
      },
    };
    const docs: Record<string, string> = {
      "https://www.sec.gov/Archives/edgar/data/1/000000000126000005/k.htm": `<p>Item 1A. Risk Factors</p><p>${words(150, "general")} Export controls on advanced chips to China could reduce our revenue. ${words(150, "other")}</p><p>Item 1B. Unresolved Staff Comments</p>`,
      "https://www.sec.gov/Archives/edgar/data/1/000000000126000009/e.htm":
        "<p>Item 2.02 Results of Operations. See Exhibit 99.1.</p>",
      "https://www.sec.gov/Archives/edgar/data/1/000000000126000009/index.json": JSON.stringify({
        directory: { item: [{ name: "e.htm" }, { name: "ex99-1.htm" }, { name: "R1.htm" }] },
      }),
      "https://www.sec.gov/Archives/edgar/data/1/000000000126000009/ex99-1.htm":
        "<p>Alpha Chips reports quarterly revenue of $61.2 billion.</p>",
    };
    const fetched: string[] = [];
    const edgar: EdgarLike = {
      submissions: async () => submissions,
      document: async (url) => {
        fetched.push(url);
        const d = docs[url];
        if (!d) throw new Error("not found");
        return d;
      },
      fullTextSearch: async (q) => ({
        hits: {
          total: { value: 1 },
          hits: [
            {
              _id: "0000000001-26-000005:k.htm",
              _source: {
                ciks: ["0000000001"],
                display_names: ["Alpha Chips  (AAA)  (CIK 0000000001)"],
                form: "10-K",
                file_date: "2026-02-20",
                period_ending: "2025-12-31",
                adsh: "0000000001-26-000005",
                q,
              },
            },
          ],
        },
      }),
    };
    const t = () => buildResearchTools({ ...base(), edgar });

    it("lists filings with links and needs a stored CIK", async () => {
      const r = out(await tool(t(), "list_filings").run({ ticker: "AAA" }));
      expect(r.entries.map((e) => [e.label, e.kind, e.source?.url])).toEqual([
        [
          "AAA 8-K filed 2026-10-01",
          "filing",
          "https://www.sec.gov/Archives/edgar/data/1/000000000126000009/e.htm",
        ],
        [
          "AAA 10-K filed 2026-02-20",
          "filing",
          "https://www.sec.gov/Archives/edgar/data/1/000000000126000005/k.htm",
        ],
      ]);
      await expect(tool(t(), "list_filings").run({ ticker: "CCC" })).rejects.toThrow(
        /no SEC identifier/,
      );
    });

    it("reads the focused passage of a 10-K section", async () => {
      const r = out(
        await tool(t(), "read_filing").run({
          ticker: "AAA",
          form: "10-K",
          section: "risk_factors",
          focus: "China export controls",
        }),
      );
      expect(r.entries[0]!.label).toMatch(/^AAA 10-K filed 2026-02-20, Risk Factors, passage \d+$/);
      expect(r.entries[0]!.text).toContain("Export controls on advanced chips to China");
      expect(r.entries[0]!.kind).toBe("filing");
    });

    it("reads an 8-K together with its press-release exhibit", async () => {
      const r = out(await tool(t(), "read_filing").run({ ticker: "AAA", form: "8-K" }));
      expect(r.entries.map((e) => e.text)).toContain(
        "Alpha Chips reports quarterly revenue of $61.2 billion.",
      );
      expect(fetched).toContain(
        "https://www.sec.gov/Archives/edgar/data/1/000000000126000009/ex99-1.htm",
      );
      expect(fetched).not.toContain(
        "https://www.sec.gov/Archives/edgar/data/1/000000000126000009/R1.htm",
      );
    });

    it("only reads sec.gov archive URLs", async () => {
      await expect(
        tool(t(), "read_filing").run({ url: "https://evil.test/x.htm" }),
      ).rejects.toThrow(/sec.gov/);
    });

    it("searches the full text of filings", async () => {
      const r = out(await tool(t(), "search_filings").run({ query: '"export controls"' }));
      expect(r.entries[0]!.text).toBe("1 documents match; newest relevant shown");
      expect(r.entries[1]!.label).toBe("Alpha Chips (AAA) 10-K filed 2026-02-20");
    });
  });
});

/** A model that calls one tool, then answers with the text the test supplies (computed from the facts it saw). */
function oneTool(name: string, args: object, answer: (facts: string) => string): AssistantModel {
  return {
    model: "fake",
    begin() {
      let step = 0;
      return {
        async next(outputs): Promise<AssistantTurn> {
          if (step++ === 0)
            return { calls: [{ id: "c1", name, arguments: JSON.stringify(args) }], text: null };
          return {
            calls: [],
            text: JSON.stringify({ answer: answer(outputs![0]!.output), displays: ["D1"] }),
          };
        },
      };
    },
  };
}
const deps = (model: AssistantModel) => ({ model, web: null, edgar: null });
const unlimited = () => new RateLimiter(ctx.db, 1000, 60_000);

describe("research chat", () => {
  it("titles threads from the question", () => {
    expect(titleFrom("  what   about AAA? ")).toBe("what about AAA?");
    expect(titleFrom("word ".repeat(40)).length).toBeLessThanOrEqual(80);
  });

  it("creates a thread, stores the verified answer with its facts and displays, and lists it", async () => {
    const p = await prepareResearch(
      ctx.db,
      sid,
      { question: "How has AAA done?", mode: "quick" },
      { limiter: unlimited() },
    );
    expect(p.created).toBe(true);
    const model = oneTool("get_fundamentals", { ticker: "AAA" }, (o) => {
      const line = o.split("\n").find((l) => l.includes("revenue, fiscal 2025"))!;
      const [id] = line.split(" | ");
      return `Revenue was $200.0B [${id}].`;
    });
    const m = await executeResearch(ctx.db, sid, p, deps(model), { now });
    expect(m.role).toBe("assistant");
    const a = m.role === "assistant" ? m.answer : null;
    expect(a!.source).toBe("model");
    expect(a!.mode).toBe("quick");
    expect(a!.displays.map((d) => d.id)).toEqual(["D1"]);
    const t = await getThread(ctx.db, sid, p.threadId);
    expect(t.messages.map((x) => x.role)).toEqual(["user", "assistant"]);
    expect((await listThreads(ctx.db, sid)).map((x) => x.id)).toContain(p.threadId);
    expect(await listThreads(ctx.db, other)).toEqual([]);

    // A follow-up carries the verified turn as context.
    const p2 = await prepareResearch(
      ctx.db,
      sid,
      { question: "And its margin?", mode: "quick", threadId: p.threadId },
      { limiter: unlimited() },
    );
    expect(p2.created).toBe(false);
    expect(p2.history).toEqual([
      { question: "How has AAA done?", answer: "Revenue was $200.0B [F1]." },
    ]);
  });

  it("keeps fallbacks out of the context", () => {
    const fb = (source: "model" | "fallback", id: number): ChatMessage => ({
      id,
      role: "assistant",
      content: `a${id}`,
      mode: "quick",
      createdAt: "",
      answer: { source } as never,
    });
    const q = (id: number): ChatMessage => ({
      id,
      role: "user",
      content: `q${id}`,
      mode: "quick",
      createdAt: "",
    });
    expect(verifiedTurns([q(1), fb("fallback", 2), q(3), q(4), fb("model", 5)])).toEqual([
      { question: "q4", answer: "a5" },
    ]);
  });

  it("rejects bad questions, other sessions' threads and portfolios, and enforces the limit", async () => {
    await expect(
      prepareResearch(ctx.db, sid, { question: "x", mode: "quick" }),
    ).rejects.toBeInstanceOf(AppError);
    const [t] = await listThreads(ctx.db, sid);
    await expect(
      prepareResearch(
        ctx.db,
        other,
        { question: "steal it", mode: "quick", threadId: t!.id },
        { limiter: unlimited() },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      prepareResearch(
        ctx.db,
        other,
        { question: "my portfolio?", mode: "quick", portfolioId: pid },
        { limiter: unlimited() },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    const one = new RateLimiter(ctx.db, 1, 60_000);
    await prepareResearch(
      ctx.db,
      other,
      { question: "first deep", mode: "deep" },
      { limiter: one },
    );
    await expect(
      prepareResearch(ctx.db, other, { question: "second deep", mode: "deep" }, { limiter: one }),
    ).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("keeps the question but stores no answer when stopped", async () => {
    const p = await prepareResearch(
      ctx.db,
      sid,
      { question: "Stop me", mode: "quick" },
      { limiter: unlimited() },
    );
    const ctl = new AbortController();
    const model = oneTool("list_factors", {}, () => "never");
    const run = executeResearch(ctx.db, sid, p, deps(model), {
      signal: ctl.signal,
      onEvent: (e) => {
        if (e.type === "tool_start") ctl.abort();
      },
    });
    await expect(run).rejects.toThrow(/stopped/);
    expect((await getThread(ctx.db, sid, p.threadId)).messages.map((m) => m.role)).toEqual([
      "user",
    ]);
  });

  it("deletes only the owner's thread", async () => {
    const [t] = await listThreads(ctx.db, sid);
    await expect(deleteThread(ctx.db, other, t!.id)).rejects.toMatchObject({ code: "not_found" });
    await deleteThread(ctx.db, sid, t!.id);
    await expect(getThread(ctx.db, sid, t!.id)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("one definition of each return", () => {
  it("compare and screen give the same 1-year return as the company profile and price history", async () => {
    const t = buildResearchTools(base());
    const profile = out(await tool(t, "get_company").run({ ticker: "CCC" }));
    const hist = out(await tool(t, "price_history").run({ tickers: ["CCC"], period: "1y" }));
    const cmp = out(await tool(t, "compare_companies").run({ tickers: ["CCC", "AAA"] }));
    const y1 = text(profile, "CCC return over 1 year")!;
    expect(text(hist, "CCC return, 1 year")).toMatch(new RegExp(`^\\${y1}`));
    expect(text(cmp, "CCC (Utilities) snapshot")).toContain(`1y ${y1}`);
  });
});

describe("charts offered by tools", () => {
  it("company profile offers a price line and an exposure bar chart", async () => {
    const r = out(await tool(buildResearchTools(base()), "get_company").run({ ticker: "AAA" }));
    expect(r.displays!.map((d) => d.kind)).toEqual(["line", "bar"]);
    const bar = r.displays![1]!;
    expect(bar.kind === "bar" && bar.series[0]!.values).toEqual([3]);
  });

  it("fundamentals offer a table and a trend chart without empty series", async () => {
    const r = out(
      await tool(buildResearchTools(base()), "get_fundamentals").run({ ticker: "AAA" }),
    );
    const trend = r.displays![1]!;
    expect(trend.kind).toBe("bar");
    if (trend.kind !== "bar") return;
    expect(trend.categories).toEqual(["FY2024", "FY2025"]);
    expect(trend.series.map((s) => s.name)).toEqual(["Revenue", "Net income"]);
    expect(trend.series[0]!.values).toEqual([100e9, 200e9]);
  });

  it("a comparison offers returns, risk against return, and an exposure heatmap", async () => {
    const r = out(
      await tool(buildResearchTools(base()), "compare_companies").run({
        tickers: ["AAA", "BBB", "CCC"],
      }),
    );
    expect(r.displays!.map((d) => d.kind)).toEqual(["table", "bar", "scatter", "heatmap"]);
    const heat = r.displays![3]!;
    if (heat.kind !== "heatmap") throw new Error("not a heatmap");
    expect(heat.columns).toEqual(["ai_capex", "rates"]);
    expect(heat.values).toEqual([
      [3, 0],
      [0, 2],
      [0, -2],
    ]);
    const sc = r.displays![2]!;
    if (sc.kind !== "scatter") throw new Error("not a scatter");
    const aaa = sc.points.find((p) => p.label === "AAA")!;
    // Chart values are the same one-decimal percent the facts show.
    expect(`+${aaa.y.toFixed(1)}%`).toBe(
      text(r, "AAA (Information Technology) snapshot")!.match(/1y (\+[\d.]+%)/)![1],
    );
  });

  it("a factor screen adds an exposure chart", async () => {
    const r = out(
      await tool(buildResearchTools(base()), "screen_companies").run({ factor: "rates" }),
    );
    const last = r.displays!.at(-1)!;
    expect(last.kind === "bar" && last.title).toBe("Exposure to rates (-3 to 3)");
  });
});

describe("presentations", () => {
  const ask = (id: number, content: string): ChatMessage => ({
    id,
    role: "user",
    content,
    mode: "quick",
    createdAt: "",
  });
  const ans = (id: number, content: string, answer: object): ChatMessage => ({
    id,
    role: "assistant",
    content,
    mode: "quick",
    createdAt: "",
    answer: answer as never,
  });

  it("renumbers facts and displays across answers, shares identical facts, and skips fallbacks", () => {
    const shared = { label: "NVDA return", text: "+42.0%" };
    const input = deckInputFrom("Topic", [
      ask(1, "q1"),
      ans(2, "Up +42.0% [F1].", {
        source: "model",
        facts: [{ id: "F1", ...shared }],
        displays: [{ id: "D1", kind: "table", title: "T", columns: [], rows: [] }],
        allDisplays: [{ id: "D1", kind: "table", title: "T", columns: [], rows: [] }],
      }),
      ask(3, "q2"),
      ans(4, "fallback", {
        source: "fallback",
        facts: [{ id: "F1", label: "x", text: "1" }],
        displays: [],
      }),
      ask(5, "q3"),
      ans(6, "Vol 30.0% [F1], and up +42.0% [F2].", {
        source: "model",
        facts: [
          { id: "F1", label: "NVDA volatility", text: "30.0%" },
          { id: "F2", ...shared },
        ],
        displays: [],
        allDisplays: [{ id: "D1", kind: "table", title: "U", columns: [], rows: [] }],
      }),
    ]);
    expect(input.sections.map((x) => x.question)).toEqual(["q1", "q3"]);
    expect(input.facts.map((f) => `${f.id} ${f.label}`)).toEqual([
      "F1 NVDA return",
      "F2 NVDA volatility",
    ]);
    expect(input.sections[1]!.answer).toBe("Vol 30.0% [F2], and up +42.0% [F1].");
    expect(input.sections[1]!.factIds).toEqual(["F2", "F1"]);
    expect(input.displays.map((d) => `${d.id} ${d.title}`)).toEqual(["D1 T", "D2 U"]);
    expect(input.sections[0]!.displayIds).toEqual(["D1"]);
  });

  const deckGen = (raw: (prompt: string) => unknown): DeckGenerator & { prompts: string[] } => {
    const prompts: string[] = [];
    return {
      model: "fake",
      prompts,
      generate: async (p) => {
        prompts.push(p);
        return raw(p);
      },
    };
  };

  it("needs a verified answer, stores the deck, replaces it when made again, and is private", async () => {
    const empty = await prepareResearch(
      ctx.db,
      sid,
      { question: "Nothing yet", mode: "quick" },
      { limiter: unlimited() },
    );
    await expect(
      makeDeck(
        ctx.db,
        sid,
        empty.threadId,
        deckGen(() => null),
        { limiter: unlimited() },
      ),
    ).rejects.toMatchObject({
      code: "bad_request",
    });

    const p = await prepareResearch(
      ctx.db,
      sid,
      { question: "AAA figures?", mode: "quick" },
      { limiter: unlimited() },
    );
    await executeResearch(
      ctx.db,
      sid,
      p,
      deps(
        oneTool("get_fundamentals", { ticker: "AAA" }, (o) => {
          const id = o
            .split("\n")
            .find((l) => l.includes("revenue, fiscal 2025"))!
            .split(" | ")[0];
          return `Revenue was $200.0B [${id}].`;
        }),
      ),
      { now },
    );
    expect(await getDeck(ctx.db, sid, p.threadId)).toBeNull();

    const slide = (title: string) => ({
      title,
      bullets: ["Revenue was $200.0B [F1]."],
      display: "D1",
      notes: "Say it [F1].",
    });
    const gen = deckGen(() => ({
      title: "AAA",
      subtitle: "Findings",
      slides: [slide("A"), slide("B"), slide("C")],
    }));
    const d = await makeDeck(ctx.db, sid, p.threadId, gen, { limiter: unlimited() });
    expect(d.source).toBe("model");
    expect(d.displays.map((x) => x.id)).toEqual(["D1", "D2"]);
    expect(gen.prompts[0]).toContain("F1 | AAA revenue, fiscal 2025: $200.0B");
    expect(d.disclaimer).toMatch(/not investment advice/);

    const again = await makeDeck(
      ctx.db,
      sid,
      p.threadId,
      deckGen(() => null),
      { limiter: unlimited() },
    );
    expect(again.source).toBe("fallback");
    expect((await getDeck(ctx.db, sid, p.threadId))!.source).toBe("fallback");

    await expect(getDeck(ctx.db, other, p.threadId)).rejects.toMatchObject({ code: "not_found" });
    const one = new RateLimiter(ctx.db, 0, 60_000);
    await expect(makeDeck(ctx.db, sid, p.threadId, gen, { limiter: one })).rejects.toMatchObject({
      code: "rate_limited",
    });
  });
});
