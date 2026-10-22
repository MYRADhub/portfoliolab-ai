import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { BASE, COVERED, EXAMPLE, mock, newSession, startUiSession } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PAIR = [
  { ticker: "NVDA", weightPct: 60 },
  { ticker: "AAPL", weightPct: 40 },
];

test.describe("company research API", () => {
  test("returns prices, statistics, exposures, ranked peers and linked news", async ({ page }) => {
    const r = await page.request.get("/api/research/nvda");
    expect(r.status()).toBe(200);
    const b = (await r.json()) as Json;
    expect(b.company).toMatchObject({ ticker: "NVDA" });
    expect(b.prices.length).toBeGreaterThan(200);
    expect(b.stats.y1).not.toBeNull();
    expect(b.stats.volatility).toBeGreaterThan(0);
    expect(b.stats.high52).toBeGreaterThanOrEqual(b.stats.low52);

    // Strongest exposures first; ties by name.
    expect(b.exposures.slice(0, 2).map((e: Json) => [e.slug, e.signed])).toEqual([
      ["ai_capex", 3],
      ["taiwan", -3],
    ]);
    // Cosine similarity of exposure profiles, computed by hand: MSFT 0.65, AAPL 0.54, AMZN 0.28.
    expect(b.peers.slice(0, 3).map((p: Json) => p.ticker)).toEqual(["MSFT", "AAPL", "AMZN"]);
    expect(b.peers).toHaveLength(5);
    expect(b.peers[0].basis).toBe("exposure");
    expect(b.peers[0].similarity).toBeCloseTo(7 / (Math.sqrt(23) * Math.sqrt(5)), 10);

    const titles = b.news.map((n: Json) => n.title);
    expect(titles).toContain("E2E Radar NVDA earnings miss");
    const miss = b.news.find((n: Json) => n.title === "E2E Radar NVDA earnings miss");
    expect(miss.relevance.score).toBeGreaterThan(0);
    expect(miss.classification.class).toBe("fundamental");
  });

  test("falls back to same-sector peers when a company has no exposure profile", async ({
    page,
  }) => {
    const b = (await (await page.request.get("/api/research/XOM")).json()) as Json;
    expect(b.exposures).toEqual([]);
    expect(b.peers.length).toBeGreaterThan(0);
    expect(b.peers.every((p: Json) => p.basis === "sector" && p.sector === b.company.sector)).toBe(
      true,
    );
  });

  test("leaves long-window statistics empty when history is short", async ({ page }) => {
    const b = (await (await page.request.get("/api/research/TGT")).json()) as Json;
    expect(b.stats.y1).toBeNull();
    expect(b.stats.volatility).toBeNull();
    expect(b.stats.last).not.toBeNull();
  });

  test("rejects unknown and malformed tickers", async ({ page }) => {
    expect((await page.request.get("/api/research/ZZZZ")).status()).toBe(404);
    expect((await page.request.get("/api/research/bad%20ticker!")).status()).toBe(400);
  });
});

test.describe("what-if add API", () => {
  test("reports the before and after concentration and matches the exposure arithmetic", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Pair", PAIR);
    const r = (await (
      await page.request.get(`/api/portfolios/${id}/whatif?ticker=MSFT&weight=0.1`)
    ).json()) as Json;
    expect(r.available).toBe(true);
    expect(r.weight).toBe(0.1);
    expect(r.score.before.effectiveSectors).toBeGreaterThan(0);
    expect(r.score.after.effectiveFactors).not.toBe(r.score.before.effectiveFactors);
    // Same numbers Discovery shows for the same candidate at the same size.
    const d = (await (
      await page.request.get(`/api/portfolios/${id}/discovery?weight=0.1`)
    ).json()) as Json;
    const msft = d.candidates.find((c: Json) => c.ticker === "MSFT");
    expect(msft.effectiveFactorsAfter).toBeCloseTo(r.score.after.effectiveFactors, 12);
  });

  test("explains why it cannot compute, and validates input", async ({ page, playwright }) => {
    const s = await startUiSession(page);
    const id = await s.create("Pair", PAIR);
    const get = async (q: string) => await page.request.get(`/api/portfolios/${id}/whatif?${q}`);
    expect(((await (await get("ticker=NVDA")).json()) as Json).reason).toBe("already_held");
    expect(((await (await get("ticker=JPM")).json()) as Json).reason).toBe("candidate_unprofiled");
    expect((await get("ticker=MSFT&weight=0.9")).status()).toBe(400);
    expect((await get("")).status()).toBe(400);
    expect((await get("ticker=ZZZZ")).status()).toBe(404);

    const partial = await s.create("Partial", EXAMPLE);
    const r = (await (
      await page.request.get(`/api/portfolios/${partial}/whatif?ticker=MSFT`)
    ).json()) as Json;
    expect(r).toMatchObject({ available: false, reason: "missing_exposures" });

    const other = await newSession(playwright);
    expect((await other.get(`/api/portfolios/${id}/whatif?ticker=MSFT`)).status()).toBe(404);
  });
});

test.describe("assistant API", () => {
  test.beforeEach(async () => {
    await mock.reset();
  });

  const ask = (page: import("@playwright/test").Page, id: string, question: string) =>
    page.request.post(`/api/portfolios/${id}/assistant`, { data: { question } });

  test("answers from tool results with citations that exist", async ({ page }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    const r = await ask(page, id, "How risky is my portfolio?");
    expect(r.status()).toBe(200);
    const b = (await r.json()) as Json;
    expect(b.result.source).toBe("model");
    expect(b.result.toolCalls[0].name).toBe("get_portfolio_summary");
    expect(b.result.facts.length).toBeGreaterThan(5);
    expect(b.result.answer).toMatch(/\[F1\]/);
    expect(b.disclaimer).toMatch(/not investment advice/);
    const ids = new Set(b.result.facts.map((f: Json) => f.id));
    for (const m of b.result.answer.matchAll(/F\d+/g)) expect(ids.has(m[0])).toBe(true);
    // The model was told to use tools and was offered all of them.
    const req = (await mock.requests())[0]!;
    expect(req.instructions).toMatch(/Always call the tools/);
  });

  test("can look up a company the user names", async ({ page }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    const b = (await (await ask(page, id, "Tell me about NVDA")).json()) as Json;
    expect(b.result.toolCalls[0]).toEqual({ name: "get_company", arguments: '{"ticker":"NVDA"}' });
    expect(b.result.facts.map((f: Json) => f.label).join(" ")).toContain("NVDA sector");
  });

  test("replaces an ungrounded answer with the verified figures", async ({ page }) => {
    await mock.setMode("ungrounded");
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    const b = (await (await ask(page, id, "How risky is my portfolio?")).json()) as Json;
    expect(b.result.source).toBe("fallback");
    expect(b.result.answer).not.toContain("99.99");
    expect(b.result.issues[0]).toMatchObject({ kind: "ungrounded_number", detail: "99.99" });
    expect(b.result.facts.length).toBeGreaterThan(0);
  });

  test("retries once with the problems listed and then succeeds", async ({ page }) => {
    await mock.setMode("retry");
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    const b = (await (await ask(page, id, "How risky is my portfolio?")).json()) as Json;
    expect(b.result.source).toBe("model");
    const reqs = await mock.requests();
    expect(reqs.some((r) => r.input.includes("rejected for"))).toBe(true);
  });

  test("validates the question, ownership, and upstream failures", async ({ page, playwright }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    expect((await ask(page, id, "hi")).status()).toBe(400);
    expect((await ask(page, id, "x".repeat(501))).status()).toBe(400);
    const other = await newSession(playwright);
    expect(
      (
        await other.post(`/api/portfolios/${id}/assistant`, { data: { question: "How risky?" } })
      ).status(),
    ).toBe(404);
    await mock.setMode("error");
    expect((await ask(page, id, "How risky is my portfolio?")).status()).toBeGreaterThanOrEqual(
      500,
    );
  });

  test("shares the hourly AI allowance across questions", async ({ page }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    for (let i = 0; i < 10; i++)
      expect((await ask(page, id, `Question number ${i} about risk`)).status()).toBe(200);
    const r = await ask(page, id, "One more question about risk");
    expect(r.status()).toBe(429);
  });
});

test.describe("research page", () => {
  test.beforeEach(async () => {
    await mock.reset();
  });

  test("search finds a company and its page shows everything", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Pair", PAIR);
    await page.goto("/research");
    await page.getByLabel("Look up a company").fill("nvd");
    const hit = page
      .getByRole("list", { name: "Search results" })
      .getByRole("link", { name: /NVDA/ });
    await hit.click();
    await expect(page).toHaveURL(/\/research\/NVDA$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("NVDA");
    await expect(page.getByRole("group", { name: "Key statistics" })).toContainText("1 year");
    await expect(page.locator(".recharts-surface").first()).toBeVisible();
    const exposures = page.getByRole("list", { name: "Exposures" });
    await expect(exposures.locator("li").first()).toContainText("AI infrastructure capex");
    await expect(exposures.locator("li").first()).toContainText("+3 of 3");
    const peers = page.getByRole("list", { name: "Peers" });
    await expect(peers.locator("li").first()).toContainText("MSFT");
    await expect(page.getByText("E2E Radar NVDA earnings miss")).toBeVisible();
    const ratios = page.getByLabel("Fundamental ratios");
    await expect(ratios).toContainText("+30.0%"); // 130B / 100B - 1
    await expect(ratios).toContainText("55.4%"); // net margin 72 / 130
    await expect(ratios).toContainText("63.1%"); // operating margin 82 / 130
    await expect(ratios).toContainText("90.0%"); // return on equity 72 / 80
    const table = page.getByRole("table", { name: "Annual figures" });
    await expect(table.getByRole("row", { name: /Revenue/ })).toContainText("$130.0B");
    await expect(table.getByRole("row", { name: /Revenue/ })).toContainText("$100.0B");
    await expect(table.getByRole("row", { name: /Diluted EPS/ })).toContainText("2.94");
    await expect(page.getByText(/Source: SEC annual reports/)).toBeVisible();
  });

  test("exposure rows say when a score is an unreviewed AI draft", async ({ page }) => {
    await page.goto("/research/AMZN");
    const rows = page.getByRole("list", { name: "Exposures" }).locator("li");
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: "AI draft, not reviewed" })).toHaveCount(3);
    await page.goto("/research/NVDA");
    await expect(page.getByRole("list", { name: "Exposures" }).locator("li").first()).toBeVisible();
    await expect(page.getByText("AI draft, not reviewed")).toHaveCount(0);
  });

  test("a company without SEC figures says so", async ({ page }) => {
    await page.goto("/research/MSFT");
    await expect(
      page.getByText("No SEC annual figures are loaded for this company."),
    ).toBeVisible();
  });

  test("search says when nothing matches", async ({ page }) => {
    await page.goto("/research");
    await page.getByLabel("Look up a company").fill("qqqqzzzz");
    await expect(page.getByText("No matching companies.")).toBeVisible();
  });

  test("an unknown ticker shows an error instead of a blank page", async ({ page }) => {
    await page.goto("/research/ZZZZ");
    await expect(page.getByRole("alert").filter({ hasText: /not found/i })).toBeVisible();
  });

  test("what-if changes with the position size and handles an already-held company", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Pair", PAIR);
    await page.goto("/research/MSFT");
    const result = page.getByRole("region", { name: "What-if result" });
    await expect(result).toContainText("Effective hidden forces");
    const before = await result.innerText();
    await page.getByRole("button", { name: "10%", exact: true }).click();
    await expect(page.getByRole("button", { name: "10%", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(result).not.toHaveText(before);
    await page.goto("/research/NVDA");
    await expect(page.getByText("NVDA is already in this portfolio.")).toBeVisible();
  });

  test("with no portfolio, the what-if card asks the user to create one", async ({ page }) => {
    await startUiSession(page);
    await page.goto("/research/MSFT");
    await expect(page.getByText(/Create a portfolio to see how adding MSFT/)).toBeVisible();
  });

  test("the assistant answers a suggested question with citations and figures", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Covered", COVERED);
    await page.goto("/research");
    await page.getByRole("button", { name: "Is my portfolio really diversified?" }).click();
    const answer = page.getByRole("region", { name: "Assistant answer" });
    await expect(answer).toContainText("Analysis window:");
    await expect(answer.locator("sup").first()).toHaveText("F1");
    await expect(answer).toContainText("Looked at: Portfolio summary");
    await answer.getByText("Figures used").click();
    await expect(answer.getByText(/F1 Analysis window:/)).toBeVisible();
    await expect(answer.getByText(/not investment advice/)).toBeVisible();
  });

  test("a follow-up question carries the earlier turns as context", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Covered", COVERED);
    await page.goto("/research");
    await page.getByLabel("Your question").fill("How risky is my portfolio?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByRole("region", { name: "Assistant answer" })).toBeVisible();
    await page.getByLabel("Your question").fill("And which news matters most?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText("Earlier in this conversation (1)")).toBeVisible();
    await page.getByText("Earlier in this conversation (1)").click();
    await expect(
      page.getByRole("list", { name: "Earlier questions" }).getByText("How risky is my portfolio?"),
    ).toBeVisible();
    const reqs = await mock.requests();
    const last = reqs.filter((r) => r.input.includes("And which news matters most?")).at(-1)!;
    expect(last.input).toContain("Earlier in this conversation");
    expect(last.input).toContain("How risky is my portfolio?");
    expect(last.input).toContain("New question: And which news matters most?");
  });

  test("the history is validated by the API", async ({ page }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    const post = (history: unknown) =>
      page.request.post(`/api/portfolios/${id}/assistant`, {
        data: { question: "How risky is my portfolio?", history },
      });
    expect((await post("nope")).status()).toBe(400);
    expect(
      (await post(Array.from({ length: 5 }, () => ({ question: "q", answer: "a" })))).status(),
    ).toBe(400);
    expect((await post([{ question: "q", answer: "x".repeat(1501) }])).status()).toBe(400);
    expect((await post([{ question: "Earlier?", answer: "Earlier answer." }])).status()).toBe(200);
  });

  test("holdings export is a CSV for the owner only", async ({ page, playwright }) => {
    const s = await startUiSession(page);
    const id = await s.create('My, "quoted" book', COVERED);
    const r = await page.request.get(`/api/portfolios/${id}/export`);
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toContain("text/csv");
    expect(r.headers()["content-disposition"]).toContain("My_quoted_book-holdings.csv");
    const [head, ...rows] = (await r.text()).trim().split("\n");
    expect(head).toBe(
      "ticker,name,sector,weight,price,return_1d,return_5d,return_1m,share_of_risk,as_of",
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatch(/^NVDA,/);
    const other = await playwright.request.newContext({ baseURL: BASE });
    await other.post("/api/session");
    expect((await other.get(`/api/portfolios/${id}/export`)).status()).toBe(404);
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Export holdings (CSV)" })).toHaveAttribute(
      "href",
      `/api/portfolios/${id}/export`,
    );
  });

  test("the assistant shows only figures, with a notice, when the answer cannot be verified", async ({
    page,
  }) => {
    await mock.setMode("ungrounded");
    const s = await startUiSession(page);
    await s.create("Covered", COVERED);
    await page.goto("/research");
    await page.getByLabel("Your question").fill("How risky is my portfolio?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText(/could not be verified/)).toBeVisible();
    await expect(page.getByText("99.99")).toHaveCount(0);
  });

  test("the assistant shows an error and recovers when the service fails", async ({ page }) => {
    await mock.setMode("error");
    const s = await startUiSession(page);
    await s.create("Covered", COVERED);
    await page.goto("/research");
    await page.getByLabel("Your question").fill("How risky is my portfolio?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: /./ }).first()).toBeVisible();
    await mock.setMode("grounded");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByRole("region", { name: "Assistant answer" })).toBeVisible();
  });

  for (const theme of ["light", "dark"]) {
    test(`the company page and an assistant answer have no accessibility violations in ${theme}`, async ({
      page,
    }) => {
      await page.addInitScript((t) => localStorage.setItem("pl-theme", t), theme);
      const s = await startUiSession(page);
      await s.create("Pair", PAIR);
      await page.goto("/research/MSFT");
      await expect(page.getByRole("region", { name: "What-if result" })).toBeVisible();
      await expect(page.getByText("E2E Radar MSFT celebrity gossip")).toBeVisible();
      const scan = async () => {
        // Let CSS transitions finish so colors are final when measured.
        await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
        const r = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);
      };
      await scan();
      await page.goto("/research");
      await page.getByRole("button", { name: "Is my portfolio really diversified?" }).click();
      await expect(page.getByRole("region", { name: "Assistant answer" })).toBeVisible();
      await scan();
    });
  }
});
