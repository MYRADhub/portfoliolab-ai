import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { COVERED, EXAMPLE, createPortfolio, newSession, startUiSession } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

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

const tab = (page: import("@playwright/test").Page, name: string) =>
  page.getByRole("tab", { name: new RegExp(`${name}$`, "i") });
const fmt = (x: number, d = 2) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;

test.describe("terminal page", () => {
  test("is a tabbed workspace with four sections, Overview first", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Terminal", EXAMPLE);
    await page.goto("/terminal");
    await expect(page.getByRole("heading", { name: "Terminal", level: 1 })).toBeVisible();
    const tabs = page.getByRole("tablist", { name: "Terminal sections" }).getByRole("tab");
    await expect(tabs).toHaveText([/Overview/, /Risk/, /Calendar/, /Context/]);
    await expect(tab(page, "Overview")).toHaveAttribute("aria-selected", "true");
    for (const name of ["Risk", "Calendar", "Context"])
      await expect(tab(page, name)).toHaveAttribute("aria-selected", "false");
    await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "tab-overview");
    await expect(page.getByText("Keys 1-4 switch sections")).toBeVisible();
  });

  test("the Overview shows the index, performance and holdings with numbers that match the API", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Terminal", EXAMPLE);
    await page.goto("/terminal");
    const api = (await (await page.request.get(`/api/portfolios/${id}/terminal`)).json()) as Json;

    await expect(page.getByLabel("Portfolio index", { exact: true })).toHaveText(
      api.index.value.toFixed(2),
    );
    await expect(page.getByLabel("Day change", { exact: true })).toHaveText(
      fmt(api.index.dayChange),
    );
    await expect(page.getByText(`As of ${api.asOf}`)).toBeVisible();
    for (const name of ["Portfolio index", "Performance", "Holdings monitor"])
      await expect(page.getByRole("heading", { name, level: 2, exact: true })).toBeVisible();

    for (const p of api.performance) {
      await expect(
        page.getByRole("row", { name: new RegExp(`^${p.label}`) }).first(),
      ).toContainText(p.value === null ? "n/a" : fmt(p.value));
    }
    const monitor = page.getByRole("table", { name: "Holdings monitor" });
    await expect(monitor.locator("tbody tr")).toHaveCount(5);
    await expect(monitor.locator("tbody tr").first()).toContainText("NVDA");
    await expect(monitor.locator("tbody tr").first()).toContainText("25.0%");
    await expect(monitor.getByRole("img", { name: /60-day price trend/ })).toHaveCount(5);
    await expect(page.locator(".recharts-surface")).toHaveCount(1);
  });

  test("the Risk section shows the risk table, risk versus weight, volatility, drawdowns and the distribution", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Terminal", EXAMPLE);
    await page.goto("/terminal");
    const api = (await (await page.request.get(`/api/portfolios/${id}/terminal`)).json()) as Json;
    await tab(page, "Risk").click();
    for (const name of [
      "Risk",
      "Risk versus weight",
      "Rolling 21-day volatility",
      "Worst drawdowns",
      "Daily return distribution",
    ]) {
      await expect(page.getByRole("heading", { name, level: 2, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("row", { name: /Volatility \(annualized\)/ })).toContainText(
      `${(api.risk.volatility * 100).toFixed(1)}%`,
    );
    await expect(page.getByRole("row", { name: /Sharpe ratio/ })).toContainText(
      api.risk.sharpe.toFixed(2),
    );
    await expect(page.getByRole("row", { name: /1-day VaR 95%/ })).toContainText(
      fmt(api.risk.var95),
    );
    await expect(
      page.getByRole("list", { name: "Risk versus weight" }).getByRole("listitem"),
    ).toHaveCount(5);
    await expect(
      page.getByRole("table", { name: "Worst drawdowns" }).locator("tbody tr"),
    ).toHaveCount(api.drawdowns.length);
    await expect(page.locator(".recharts-surface")).toHaveCount(2);
  });

  test("the Calendar section shows monthly returns with a yearly total, and the five best and worst days", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Terminal", EXAMPLE);
    await page.goto("/terminal");
    const api = (await (await page.request.get(`/api/portfolios/${id}/terminal`)).json()) as Json;
    await tab(page, "Calendar").click();
    const table = page.getByRole("table", { name: "Monthly returns" });
    await expect(table.locator("thead th")).toHaveCount(14); // Year, 12 months, Year total
    const years = new Set<string>(api.monthly.map((m: Json) => m.month.slice(0, 4)));
    await expect(table.locator("tbody tr")).toHaveCount(years.size);
    const lastYear = [...years].at(-1)!;
    const yearTotal =
      api.monthly
        .filter((m: Json) => m.month.startsWith(lastYear))
        .reduce((g: number, m: Json) => g * (1 + m.return), 1) - 1;
    await expect(table.locator("tbody tr").last()).toContainText(fmt(yearTotal, 1));

    const best = page.getByRole("list", { name: "Best days" }).getByRole("listitem");
    const worst = page.getByRole("list", { name: "Worst days" }).getByRole("listitem");
    await expect(best).toHaveCount(5);
    await expect(worst).toHaveCount(5);
    await expect(best.first()).toContainText(api.extremes.best[0].date);
    await expect(best.first()).toContainText(fmt(api.extremes.best[0].value));
    await expect(worst.first()).toContainText(fmt(api.extremes.worst[0].value));
  });

  test("the Context section shows exposure, correlation and news cards", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Terminal", EXAMPLE);
    await page.goto("/terminal");
    await tab(page, "Context").click();
    await expect(page.getByText("Some holdings have no exposure data yet.")).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Most correlated pairs" }).getByRole("listitem"),
    ).toHaveCount(3);
    const news = page.getByRole("list", { name: "Relevant news" }).locator(":scope > li");
    await expect(news).toHaveCount(4);
    await expect(news.first()).toContainText("E2E Radar NVDA earnings miss");
    await expect(news.first().getByRole("img", { name: /^Relevance/ })).toBeVisible();
  });

  test("keys 1 to 4, arrow keys, Home and End switch sections, and the section is kept in the address", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Terminal", EXAMPLE);
    await page.goto("/terminal");
    await expect(tab(page, "Overview")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("3");
    await expect(tab(page, "Calendar")).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/#calendar$/);
    await page.keyboard.press("2");
    await expect(page.getByRole("heading", { name: "Rolling 21-day volatility" })).toBeVisible();
    await page.keyboard.press("1");
    await expect(page.getByRole("heading", { name: "Holdings monitor", level: 2 })).toBeVisible();

    await tab(page, "Overview").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab(page, "Risk")).toHaveAttribute("aria-selected", "true");
    await expect(tab(page, "Risk")).toBeFocused();
    await page.keyboard.press("End");
    await expect(tab(page, "Context")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight"); // wraps around
    await expect(tab(page, "Overview")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(tab(page, "Context")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(tab(page, "Overview")).toHaveAttribute("aria-selected", "true");
    // Only the selected tab is in the tab order.
    await expect(tab(page, "Risk")).toHaveAttribute("tabindex", "-1");
  });

  test("a deep link opens the right section, and typing in a field never switches sections", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Terminal", EXAMPLE);
    await s.create("Second", COVERED); // a second portfolio gives the page a selector to type into
    await page.goto("/terminal#risk");
    await expect(tab(page, "Risk")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Worst drawdowns" })).toBeVisible();
    await page.goto("/terminal#nonsense");
    await expect(tab(page, "Overview")).toHaveAttribute("aria-selected", "true");
    await page.getByLabel("Portfolio", { exact: true }).focus();
    await page.keyboard.press("3");
    await expect(tab(page, "Overview")).toHaveAttribute("aria-selected", "true");
  });

  test("editing the address or going back changes the section", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Terminal", EXAMPLE);
    await page.goto("/terminal#risk");
    await expect(tab(page, "Risk")).toHaveAttribute("aria-selected", "true");
    await page.evaluate(() => (window.location.hash = "calendar"));
    await expect(tab(page, "Calendar")).toHaveAttribute("aria-selected", "true");
    await page.goBack();
    await expect(tab(page, "Risk")).toHaveAttribute("aria-selected", "true");
  });

  test("never scrolls the page on a desktop screen, in any section", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Terminal", EXAMPLE);
    await page.goto("/terminal");
    for (const name of ["Overview", "Risk", "Calendar", "Context"]) {
      await tab(page, name).click();
      await page.waitForTimeout(250);
      const m = await page.evaluate(() => ({
        doc: document.documentElement.scrollHeight - window.innerHeight,
        body: document.body.scrollHeight - window.innerHeight,
      }));
      expect(m.doc, `${name}: document scrolls`).toBeLessThanOrEqual(1);
      expect(m.body, `${name}: body scrolls`).toBeLessThanOrEqual(1);
    }
  });

  test("every panel's question mark leads to a real section of the guide", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Links", EXAMPLE);
    await page.goto("/terminal");
    const hrefs = new Set<string>();
    for (const name of ["Overview", "Risk", "Calendar", "Context"]) {
      await tab(page, name).click();
      for (const h of await page
        .locator("a[aria-label^='About ']")
        .evaluateAll((els) => els.map((e) => e.getAttribute("href")!)))
        hrefs.add(h);
    }
    expect(hrefs.size).toBe(13);
    await page.goto("/guide");
    for (const href of hrefs) {
      expect(href).toMatch(/^\/guide#terminal-[a-z-]+$/);
      await expect(page.locator(`#${href.split("#")[1]}`), href).toHaveCount(1);
    }
  });

  test("colored numbers always carry a sign, in every section", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Signs", EXAMPLE);
    await page.goto("/terminal");
    let seen = 0;
    for (const name of ["Overview", "Risk", "Calendar"]) {
      await tab(page, name).click();
      await expect(page.locator(".text-gain, .text-loss").first()).toBeVisible();
      for (const text of await page.locator(".text-gain").allTextContents()) {
        expect(text.trim(), text).toMatch(/^\+/);
        seen++;
      }
      for (const text of await page.locator(".text-loss").allTextContents()) {
        if (text.trim() && !/^\s*Alert/.test(text)) expect(text.trim(), text).toMatch(/^-/);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(15);
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
    await page.goto("/terminal#context");
    await expect(page.getByText("Needs at least two holdings.")).toBeVisible();
  });

  test("shows exposure highlights for a covered portfolio", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Covered", COVERED);
    await page.goto("/terminal#context");
    await expect(page.getByText(/Effective sectors/)).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Largest factors" }).getByRole("listitem"),
    ).toHaveCount(3);
  });

  test("follows the app-wide theme instead of forcing its own", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Theme", EXAMPLE);
    const isDark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));
    await page.goto("/terminal");
    await expect(page.getByRole("heading", { name: "Holdings monitor" })).toBeVisible();
    expect(await isDark()).toBe(false); // light by default: opening the Terminal does not change the theme
    await page.getByRole("button", { name: /Dark mode/ }).click();
    expect(await isDark()).toBe(true);
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    expect(await isDark()).toBe(true); // leaving the Terminal does not change it either
  });

  for (const theme of ["light", "dark"] as const) {
    for (const name of ["Overview", "Risk", "Calendar", "Context"]) {
      test(`${name} has no accessibility violations in the ${theme} theme`, async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem("pl-theme", t), theme);
        const s = await startUiSession(page);
        await s.create("A11y", COVERED);
        await page.goto(`/terminal#${name.toLowerCase()}`);
        await expect(tab(page, name)).toHaveAttribute("aria-selected", "true");
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(300);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const summary = results.violations.map(
          (v) =>
            `${v.id} (${v.impact}): ${v.nodes.length} node(s) e.g. ${v.nodes[0]?.html.slice(0, 140)}`,
        );
        expect(summary, summary.join("\n")).toEqual([]);
      });
    }
  }
});
