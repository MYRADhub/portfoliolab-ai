import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  EXAMPLE,
  NEWS_TITLE,
  appAlert,
  createPortfolio,
  newSession,
  startUiSession,
} from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const R = {
  nvda: "E2E Radar NVDA earnings miss",
  aapl: "E2E Radar AAPL product buzz",
  msft: "E2E Radar MSFT celebrity gossip",
  amzn: "E2E Radar AMZN unclassified",
  jpm: "E2E Radar JPM stale rumor",
};

const weightFactor = (w: number) => 0.4 + 0.6 * Math.min(1, w / 0.25);
const cap: Record<string, number> = { fundamental: 1, narrative: 0.6, unclear: 0.3, noise: 0.2 };

test.describe("radar API", () => {
  test("ranks news for the portfolio, and every score can be recomputed from its parts", async ({
    playwright,
  }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "Radar", EXAMPLE);
    const r = (await (await ctx.get(`/api/portfolios/${id}/radar`)).json()) as Json;
    expect(r.days).toBe(7);
    expect(r.threshold).toBe(1);
    expect(r.holdings).toEqual(["AAPL", "AMZN", "JPM", "MSFT", "NVDA"]);

    const titles = r.items.map((i: Json) => i.title);
    expect(titles).toEqual(expect.arrayContaining(Object.values(R)));
    expect(titles).not.toContain(NEWS_TITLE); // older than the default window
    expect(titles[0]).toBe(R.nvda); // fresh and fundamental about a large holding
    const scores = r.items.map((i: Json) => i.relevance.score);
    expect(scores).toEqual([...scores].sort((a: number, b: number) => b - a));

    const weights: Record<string, number> = {
      NVDA: 0.25,
      AAPL: 0.2,
      MSFT: 0.2,
      AMZN: 0.15,
      JPM: 0.2,
    };
    for (const item of r.items) {
      const rel = item.relevance;
      // exposure match is a noisy-or of link score x weight factor over the matched holdings
      const miss = rel.matched.reduce(
        (a: number, m: Json) => a * (1 - m.linkScore * weightFactor(weights[m.ticker]!)),
        1,
      );
      expect(rel.exposureMatch).toBeCloseTo(1 - miss, 12);
      for (const m of rel.matched) expect(m.weight).toBeCloseTo(weights[m.ticker]!, 12);
      const c = item.classification;
      const impact = c ? Math.min(Math.max(0.1, c.fundamentalImportance / 10), cap[c.class]!) : 0.5;
      expect(rel.impact).toBeCloseTo(impact, 12);
      expect(rel.recency).toBeCloseTo(0.5 ** (item.ageDays / 3), 10);
      expect(rel.score).toBeCloseTo(10 * rel.exposureMatch * rel.impact * rel.recency, 10);
      expect(rel.score).toBeLessThanOrEqual(10);
    }
  });

  test("merges syndicated copies, collapses low-relevance items instead of dropping them, and counts by class", async ({
    playwright,
  }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "Radar", EXAMPLE);
    const r = (await (await ctx.get(`/api/portfolios/${id}/radar`)).json()) as Json;
    const by = Object.fromEntries(r.items.map((i: Json) => [i.title, i]));
    expect(by[R.nvda].copies).toBe(1);
    expect(r.items.filter((i: Json) => i.title.startsWith("E2E Radar NVDA"))).toHaveLength(1);
    expect(by[R.jpm].relevance.score).toBeLessThan(1); // old, weak, unclassified
    expect(by[R.msft].relevance.score).toBeLessThan(1); // gossip about a holding
    expect(by[R.nvda].relevance.score).toBeGreaterThan(1);
    expect(r.counts.total).toBe(5);
    expect(r.counts.shown).toBe(r.items.filter((i: Json) => i.relevance.score >= 1).length);
    expect(r.counts.shown + r.counts.collapsed).toBe(r.counts.total);
    expect(r.counts.byClass).toEqual({ fundamental: 1, narrative: 1, noise: 1, unclassified: 2 });
    expect(by[R.nvda].relevance.score).toBeGreaterThan(by[R.aapl].relevance.score);
    expect(by[R.aapl].relevance.score).toBeGreaterThan(by[R.msft].relevance.score);
  });

  test("filters by period, type and holding", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "Radar", EXAMPLE);
    const titles = async (q: string) =>
      (
        ((await (await ctx.get(`/api/portfolios/${id}/radar${q}`)).json()) as Json).items as Json[]
      ).map((i) => i.title);

    expect(await titles("?class=noise")).toEqual([R.msft]);
    expect((await titles("?class=unclassified")).sort()).toEqual([R.amzn, R.jpm].sort());
    expect(await titles("?class=unclear")).toEqual([]);
    expect(await titles("?ticker=NVDA")).toEqual([R.nvda]);
    expect(await titles("?ticker=NVDA&class=noise")).toEqual([]);
    expect(await titles("?days=1")).not.toContain(R.aapl); // 26 hours old
    expect(await titles("?days=1")).toContain(R.nvda);
    expect(await titles("?days=30")).toContain(NEWS_TITLE); // the older seeded story appears with a wider window
  });

  test("validates parameters and protects the data", async ({ playwright, request }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "Radar", EXAMPLE);
    for (const q of [
      "?days=0",
      "?days=31",
      "?days=abc",
      "?class=bogus",
      "?ticker=nvda",
      "?ticker=%24%24",
    ]) {
      expect((await ctx.get(`/api/portfolios/${id}/radar${q}`)).status(), q).toBe(400);
    }
    expect((await request.get(`/api/portfolios/${id}/radar`)).status()).toBe(401);
    const intruder = await newSession(playwright);
    expect((await intruder.get(`/api/portfolios/${id}/radar`)).status()).toBe(404);
    expect((await ctx.get("/api/portfolios/not-a-uuid/radar")).status()).toBe(400);
  });

  test("a portfolio with no matching news gets an empty radar, and thin price history does not matter", async ({
    playwright,
  }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "Quiet", [
      { ticker: "XOM", weightPct: 50 },
      { ticker: "TGT", weightPct: 50 },
    ]);
    const r = (await (await ctx.get(`/api/portfolios/${id}/radar`)).json()) as Json;
    expect(r).toMatchObject({
      items: [],
      counts: { total: 0, shown: 0, collapsed: 0, byClass: {} },
    });
  });
});

test.describe("News page", () => {
  const scoresOnPage = async (page: import("@playwright/test").Page) => {
    const labels = await page
      .locator("[aria-label^='Relevance ']")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!));
    return labels.map((l) => Number(/Relevance ([\d.]+) out of 10/.exec(l)![1]));
  };

  test("shows ranked items with scores, holdings, types and age, with low-relevance items collapsed", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Radar", EXAMPLE);
    await page.goto("/news");
    await expect(page.getByRole("heading", { name: "News", level: 1 })).toBeVisible();
    const ranked = page.getByRole("list", { name: "Ranked news" });
    await expect(ranked).toBeVisible();
    await expect(ranked.getByRole("listitem")).toHaveCount(3);
    await expect(ranked.getByRole("listitem").first()).toContainText(R.nvda);
    await expect(ranked.getByRole("listitem").first()).toContainText("NVDA (25% of portfolio)");
    await expect(ranked.getByRole("listitem").first()).toContainText(
      "fundamental, importance 9 of 10",
    );
    await expect(ranked.getByRole("listitem").first()).toContainText("1 similar");
    await expect(ranked.getByRole("listitem").first()).toContainText(/\d+ hours? ago/);
    const scores = await scoresOnPage(page);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));

    await expect(
      page.getByText("5 items: 3 shown, 2 collapsed as low relevance.", { exact: false }),
    ).toBeVisible();
    const low = page.getByRole("list", { name: "Low-relevance news" });
    await expect(low).toBeHidden(); // collapsed by default
    await page.getByText("2 low-relevance items").click();
    await expect(low.getByRole("listitem")).toHaveCount(2);
    await expect(low).toContainText(R.jpm);
    await expect(low).toContainText(R.msft);
  });

  test("links open in a new tab safely", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Radar", EXAMPLE);
    await page.goto("/news");
    const link = page.getByRole("link", { name: R.nvda });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(link).toHaveAttribute("href", /^https:\/\/news\.example\.com\//);
  });

  test("explains each ranking with the parts of its score", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Radar", EXAMPLE);
    await page.goto("/news");
    const first = page.getByRole("list", { name: "Ranked news" }).getByRole("listitem").first();
    await first.getByText("Why am I seeing this?").click();
    await expect(first).toContainText("Holdings touched:");
    await expect(first).toContainText("NVDA: 90% sure it is about them, 25% of your portfolio");
    await expect(first).toContainText("Economic impact: 90%");
    await expect(first).toContainText("E2E mechanism r1");
    await expect(first).toContainText("half the relevance is lost every 3 days");
    const shown = (await scoresOnPage(page))[0]!;
    await expect(first).toContainText(`= ${shown.toFixed(1)}`);
  });

  test("unclassified items say so and use a neutral impact", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Radar", EXAMPLE);
    await page.goto("/news");
    const item = page.getByRole("listitem").filter({ hasText: R.amzn });
    await expect(item).toContainText("Not yet classified");
    await item.getByText("Why am I seeing this?").click();
    await expect(item).toContainText("not yet classified, so a neutral 50%");
  });

  test("filters narrow the list and can be cleared", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Radar", EXAMPLE);
    await page.goto("/news");
    await expect(page.getByLabel("Holding").locator("option")).toHaveText([
      "All holdings",
      "AAPL",
      "AMZN",
      "JPM",
      "MSFT",
      "NVDA",
    ]);

    await page.getByLabel("Type").selectOption("noise");
    await expect(
      page.getByText("1 item: 0 shown, 1 collapsed as low relevance.", { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();
    await page.getByLabel("Type").selectOption("");
    await page.getByLabel("Holding").selectOption("NVDA");
    await expect(page.getByRole("listitem")).toHaveCount(1);
    await expect(page.getByRole("listitem").first()).toContainText(R.nvda);

    await page.getByLabel("Type").selectOption("noise");
    await expect(page.getByText("No items match these filters.")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByLabel("Type")).toHaveValue("");
    await expect(page.getByLabel("Holding")).toHaveValue("");
    await expect(page.getByRole("list", { name: "Ranked news" })).toBeVisible();
  });

  test("the period selector changes what is listed", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Radar", EXAMPLE);
    await page.goto("/news");
    await page.getByLabel("Period").selectOption("30");
    await expect(page.getByText(NEWS_TITLE)).toBeVisible();
    await page.getByLabel("Period").selectOption("1");
    await expect(page.getByText(NEWS_TITLE)).toHaveCount(0);
    await expect(page.getByText(R.nvda)).toBeVisible();
  });

  test("a portfolio with no matching news explains why the page is empty", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Quiet", [{ ticker: "XOM", weightPct: 100 }]);
    await page.goto("/news");
    await expect(
      page.getByText(/No news matched your holdings in the last 7 days\./),
    ).toBeVisible();
    await page.getByLabel("Period").selectOption("1");
    await expect(page.getByText(/in the last 1 day\./)).toBeVisible();
  });

  test("shows the empty state without portfolios and no errors", async ({ page }) => {
    await page.goto("/news");
    await expect(page.getByText("You have no portfolios yet.")).toBeVisible();
    await expect(appAlert(page)).toHaveCount(0);
  });

  test("has no accessibility violations", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Radar", EXAMPLE);
    await page.goto("/news");
    await expect(page.getByRole("list", { name: "Ranked news" })).toBeVisible();
    await page.getByText("2 low-relevance items").click();
    await page.getByText("Why am I seeing this?").first().click();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const summary = results.violations.map(
      (v) => `${v.id} (${v.impact}): ${v.nodes[0]?.html.slice(0, 120)}`,
    );
    expect(summary, summary.join("\n")).toEqual([]);
  });
});
