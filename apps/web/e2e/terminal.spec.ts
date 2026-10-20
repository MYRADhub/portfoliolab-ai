import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { COVERED, EXAMPLE, createPortfolio, newSession, startUiSession } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PANELS = [
  "Portfolio index",
  "Performance",
  "Holdings monitor",
  "Risk",
  "Risk versus weight",
  "Daily return distribution",
  "Rolling 21-day volatility",
  "Monthly returns",
  "Worst drawdowns",
  "Correlation",
  "Hidden exposure",
  "Relevant news",
];

test.describe("terminal API", () => {
  test("is internally consistent and agrees with the other endpoints", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "T", EXAMPLE);
    const t = (await (await ctx.get(`/api/portfolios/${id}/terminal`)).json()) as Json;
    const a = (await (await ctx.get(`/api/portfolios/${id}/analytics?years=2`)).json()) as Json;

    expect(t.portfolio).toEqual({ id, name: "T" });
    expect(t.window.tradingDays).toBe(a.window.tradingDays);
    expect(t.asOf).toBe(t.window.to);
    expect(t.equity[0].value).toBe(100);
    expect(t.equity).toHaveLength(t.window.tradingDays);
    expect(t.index.value).toBeCloseTo(t.equity.at(-1).value, 10);
    expect(t.index.dayChange).toBeCloseTo(t.equity.at(-1).value / t.equity.at(-2).value - 1, 12);
    expect(t.risk.volatility).toBeCloseTo(a.stats.annualizedVolatility, 12);
    expect(t.risk.maxDrawdown).toBeCloseTo(a.stats.maxDrawdown, 12);
    expect(t.risk.sharpe).toBeCloseTo(a.stats.sharpe, 12);
    expect(t.performance.map((p: Json) => p.label)).toEqual([
      "1 day",
      "1 week",
      "1 month",
      "3 months",
      "6 months",
      "Year to date",
      "1 year",
      "Whole window",
    ]);
    expect(t.performance.at(-1).value).toBeCloseTo(a.stats.totalReturn, 10);
  });

  test("holdings, risk shares, risk statistics and panel data obey their invariants", async ({
    playwright,
  }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "T", EXAMPLE);
    const t = (await (await ctx.get(`/api/portfolios/${id}/terminal`)).json()) as Json;

    expect(t.holdings.map((h: Json) => h.ticker)).toEqual(["NVDA", "AAPL", "JPM", "MSFT", "AMZN"]); // by weight, ties by ticker
    expect(t.holdings.reduce((s: number, h: Json) => s + h.weight, 0)).toBeCloseTo(1, 12);
    expect(t.holdings.reduce((s: number, h: Json) => s + h.riskShare, 0)).toBeCloseTo(1, 10);
    for (const h of t.holdings) {
      expect(h.sparkline).toHaveLength(60);
      expect(h.sparkline[0]).toBeCloseTo(100, 10);
      expect(h.price).toBeGreaterThan(0);
    }
    const { risk } = t;
    expect(risk.var99).toBeLessThanOrEqual(risk.var95);
    expect(risk.expectedShortfall95).toBeLessThanOrEqual(risk.var95);
    expect(risk.worst.value).toBeLessThanOrEqual(risk.var99);
    expect(risk.best.value).toBeGreaterThan(0);

    expect(t.histogram.reduce((s: number, b: Json) => s + b.count, 0)).toBe(
      t.window.tradingDays - 1,
    );
    expect(t.rollingVolatility).toHaveLength(t.window.tradingDays - 1 - 21 + 1);
    expect(t.monthly.reduce((g: number, m: Json) => g * (1 + m.return), 1)).toBeCloseTo(
      t.equity.at(-1).value / 100,
      9,
    );
    expect(t.drawdowns[0].depth).toBeCloseTo(risk.maxDrawdown, 12);
    expect(t.correlation.topPairs).toHaveLength(3);
    expect(t.news.length).toBeGreaterThan(0);
    const scores = t.news.map((n: Json) => n.score);
    expect(scores).toEqual([...scores].sort((x: number, y: number) => y - x));
    expect(t.exposures).toEqual({ available: false, reason: "missing_exposures" }); // JPM has no exposure fixture
  });

  test("includes exposure highlights when every holding is covered", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "Covered", COVERED);
    const t = (await (await ctx.get(`/api/portfolios/${id}/terminal`)).json()) as Json;
    expect(t.exposures.available).toBe(true);
    expect(t.exposures.topFactors).toHaveLength(3);
    expect(t.exposures.effectiveSectors).toBeLessThan(t.exposures.effectiveFactors);
  });

  test("needs a session, hides other sessions' portfolios and reports unanalysable ones", async ({
    playwright,
    request,
  }) => {
    expect(
      (await request.get("/api/portfolios/00000000-0000-4000-8000-000000000000/terminal")).status(),
    ).toBe(401);
    const owner = await newSession(playwright);
    const id = await createPortfolio(owner, "Mine", EXAMPLE);
    expect(
      (await (await newSession(playwright)).get(`/api/portfolios/${id}/terminal`)).status(),
    ).toBe(404);
    const thin = await createPortfolio(owner, "Thin", [
      { ticker: "NVDA", weightPct: 50 },
      { ticker: "TGT", weightPct: 50 },
    ]);
    expect((await owner.get(`/api/portfolios/${thin}/terminal`)).status()).toBe(409);
    expect((await owner.get("/api/portfolios/not-a-uuid/terminal")).status()).toBe(400);
  });

  test("a single holding has no correlation panel data", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "Solo", [{ ticker: "NVDA", weightPct: 100 }]);
    const t = (await (await ctx.get(`/api/portfolios/${id}/terminal`)).json()) as Json;
    expect(t.correlation).toBeNull();
    expect(t.holdings).toHaveLength(1);
    expect(t.holdings[0].riskShare).toBeCloseTo(1, 12);
  });
});

test.describe("terminal page", () => {
  test("shows every panel with live numbers that match the API", async ({ page }) => {
    const s = await startUiSession(page);
    const id = await s.create("Terminal", EXAMPLE);
    await page.goto("/terminal");
    const api = (await (await page.request.get(`/api/portfolios/${id}/terminal`)).json()) as Json;

    await expect(page.getByRole("heading", { name: "Terminal", level: 1 })).toBeVisible();
    for (const name of PANELS)
      await expect(page.getByRole("heading", { name, level: 2, exact: true })).toBeVisible();
    // The header panel is titled with the portfolio's own name.
    await expect(
      page.getByRole("heading", { name: "Terminal", level: 2, exact: true }),
    ).toBeVisible();

    await expect(page.getByLabel("Portfolio index", { exact: true })).toHaveText(
      api.index.value.toFixed(2),
    );
    const change = `${api.index.dayChange >= 0 ? "+" : ""}${(api.index.dayChange * 100).toFixed(2)}%`;
    await expect(page.getByLabel("Day change", { exact: true })).toHaveText(change);
    await expect(page.getByText(`As of ${api.asOf}`)).toBeVisible();

    const monitor = page.getByRole("table", { name: "Holdings monitor" });
    await expect(monitor.locator("tbody tr")).toHaveCount(5);
    await expect(monitor.locator("tbody tr").first()).toContainText("NVDA");
    await expect(monitor.locator("tbody tr").first()).toContainText("25.0%");
    await expect(monitor.getByRole("img", { name: /60-day price trend/ })).toHaveCount(5);

    for (const p of api.performance) {
      const row = page.getByRole("row", { name: new RegExp(`^${p.label}`) }).first();
      await expect(row).toContainText(
        p.value === null ? "n/a" : `${p.value >= 0 ? "+" : ""}${(p.value * 100).toFixed(2)}%`,
      );
    }
    await expect(page.getByRole("row", { name: /Volatility \(annualized\)/ })).toContainText(
      `${(api.risk.volatility * 100).toFixed(1)}%`,
    );
    await expect(page.getByRole("row", { name: /Sharpe ratio/ })).toContainText(
      api.risk.sharpe.toFixed(2),
    );
    await expect(
      page.getByRole("list", { name: "Risk versus weight" }).getByRole("listitem"),
    ).toHaveCount(5);
    await expect(page.locator(".recharts-surface")).toHaveCount(3); // index, distribution, rolling volatility
    await expect(
      page.getByRole("table", { name: "Monthly returns" }).locator("tbody tr").first(),
    ).toBeVisible();
    await expect(
      page.getByRole("table", { name: "Worst drawdowns" }).locator("tbody tr"),
    ).toHaveCount(api.drawdowns.length);
    await expect(
      page.getByRole("list", { name: "Most correlated pairs" }).getByRole("listitem"),
    ).toHaveCount(3);
    await expect(
      page.getByRole("list", { name: "Relevant news" }).getByRole("listitem").first(),
    ).toContainText("E2E Radar NVDA earnings miss");
    await expect(page.getByText("Some holdings have no exposure data yet.")).toBeVisible();
  });

  test("uses the dark theme only while the Terminal is open", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Theme", EXAMPLE);
    const isDark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));
    await page.goto("/terminal");
    await expect(page.getByRole("heading", { name: "Holdings monitor" })).toBeVisible();
    expect(await isDark()).toBe(true);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe("rgb(255, 255, 255)");
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    expect(await isDark()).toBe(false);
  });

  test("every panel's question mark leads to a real section of the guide", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Links", EXAMPLE);
    await page.goto("/terminal");
    await expect(page.getByRole("heading", { name: "Holdings monitor" })).toBeVisible();
    const hrefs = await page
      .locator("a[aria-label^='About ']")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href")!));
    expect(hrefs).toHaveLength(13);
    expect(new Set(hrefs).size).toBe(13);
    await page.goto("/guide");
    for (const href of hrefs) {
      expect(href).toMatch(/^\/guide#terminal(-[a-z-]+)?$/);
      await expect(page.locator(`#${href.split("#")[1]}`), href).toHaveCount(1);
    }
  });

  test("colored numbers always carry a sign, and red or green is never the only cue", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Signs", EXAMPLE);
    await page.goto("/terminal");
    await expect(page.getByRole("heading", { name: "Performance" })).toBeVisible();
    const colored = await page.locator(".text-emerald-400, .text-rose-400").allTextContents();
    expect(colored.length).toBeGreaterThan(10);
    for (const text of colored) expect(text.trim(), text).toMatch(/^[+-]?\d|n\/a|^[+-]/);
    for (const text of await page.locator(".text-emerald-400").allTextContents())
      expect(text.trim()).toMatch(/^\+/);
    for (const text of await page.locator(".text-rose-400").allTextContents())
      expect(text.trim()).toMatch(/^-/);
  });

  test("shows empty and error states cleanly", async ({ page }) => {
    await page.goto("/terminal");
    await expect(page.getByText("You have no portfolios yet.")).toBeVisible();
    const s = await startUiSession(page);
    await s.create("Thin", [
      { ticker: "NVDA", weightPct: 50 },
      { ticker: "TGT", weightPct: 50 },
    ]);
    await page.reload();
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText(
      "shared history",
    );
  });

  test("a single-holding portfolio shows the correlation placeholder", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Solo", [{ ticker: "NVDA", weightPct: 100 }]);
    await page.goto("/terminal");
    await expect(page.getByText("Needs at least two holdings.")).toBeVisible();
  });

  test("shows exposure highlights for a covered portfolio", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Covered", COVERED);
    await page.goto("/terminal");
    await expect(page.getByText(/Effective sectors/)).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Largest factors" }).getByRole("listitem"),
    ).toHaveCount(3);
  });

  test("has no accessibility violations in the dark theme", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("A11y", COVERED);
    await page.goto("/terminal");
    await expect(page.getByRole("heading", { name: "Hidden exposure" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const summary = results.violations.map(
      (v) =>
        `${v.id} (${v.impact}): ${v.nodes.length} node(s) e.g. ${v.nodes[0]?.html.slice(0, 140)}`,
    );
    expect(summary, summary.join("\n")).toEqual([]);
  });
});
