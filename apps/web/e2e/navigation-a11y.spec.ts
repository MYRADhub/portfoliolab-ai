import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { COVERED, EXAMPLE, mock, startUiSession, waitForDashboard } from "./helpers";

const pages = [
  { path: "/dashboard", heading: "Dashboard", nav: "Dashboard" },
  { path: "/terminal", heading: "Terminal", nav: "Terminal" },
  { path: "/exposures", heading: "Exposures", nav: "Exposures" },
  { path: "/correlation", heading: "Correlation", nav: "Correlation" },
  { path: "/forces", heading: "What the forces did", nav: "What the forces did" },
  { path: "/benchmark", heading: "Market comparison", nav: "Market comparison" },
  { path: "/compare", heading: "Compare", nav: "Compare" },
  { path: "/stress", heading: "Stress Lab", nav: "Stress Lab" },
  { path: "/discovery", heading: "Discovery", nav: "Discovery" },
  { path: "/rebalance", heading: "Rebalance Lab", nav: "Rebalance Lab" },
  { path: "/simulation", heading: "Simulation", nav: "Simulation" },
  { path: "/watchlist", heading: "Watchlist", nav: "Watchlist" },
  { path: "/news", heading: "News", nav: "News" },
  { path: "/events", heading: "Reactions", nav: "Reactions" },
  { path: "/research", heading: "Research", nav: "Research" },
  { path: "/evidence", heading: "Evidence", nav: "Evidence" },
  { path: "/report", heading: "Report", nav: "Report" },
  { path: "/guide", heading: "Guide", nav: "Guide" },
];

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 500 && errors.push(`http ${r.status()}: ${r.url()}`));
  return errors;
}

test.describe("navigation", () => {
  test("every sidebar link loads its page, marks itself current and logs no errors", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.goto("/dashboard");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link")).toHaveText(pages.map((p) => p.nav));
    for (const p of pages) {
      await nav.getByRole("link", { name: p.nav }).click();
      await expect(page).toHaveURL(new RegExp(`${p.path}$`));
      await expect(page.getByRole("heading", { name: p.heading, level: 1 })).toBeVisible();
      await expect(nav.getByRole("link", { name: p.nav })).toHaveAttribute("aria-current", "page");
      await expect(nav.locator("[aria-current='page']")).toHaveCount(1);
    }
    expect(errors).toEqual([]);
  });

  test("Research offers company lookup, and News describes itself", async ({ page }) => {
    await page.goto("/research");
    await expect(page.getByLabel("Look up a company")).toBeVisible();
    await page.goto("/news");
    await expect(page.getByText(/Fewer, more relevant stories/)).toBeVisible();
  });

  test("an unknown route shows the not-found page and the app recovers", async ({ page }) => {
    const r = await page.goto("/definitely-not-a-page");
    expect(r?.status()).toBe(404);
    await expect(page.getByText(/404|could not be found|not found/i).first()).toBeVisible();
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("the whole app works without console errors on a populated session", async ({ page }) => {
    const errors = trackErrors(page);
    const s = await startUiSession(page);
    await s.create("Mega caps", EXAMPLE);
    await s.create("Covered", COVERED);
    for (const p of pages) {
      await page.goto(p.path);
      await expect(page.getByRole("heading", { name: p.heading, level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
    }
    expect(errors).toEqual([]);
  });

  test("the browser back button returns to the previous page and keeps working", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Correlation" }).click();
    await expect(page).toHaveURL(/\/correlation$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goForward();
    await expect(page.getByRole("heading", { name: "Correlation", level: 1 })).toBeVisible();
  });
});

test.describe("accessibility (axe)", () => {
  test.beforeEach(async () => {
    await mock.reset();
  });

  async function scan(page: Page) {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const summary = results.violations.map(
      (v) =>
        `${v.id} (${v.impact}): ${v.nodes.length} node(s) e.g. ${v.nodes[0]?.html.slice(0, 120)}`,
    );
    expect(summary, summary.join("\n")).toEqual([]);
  }

  test("control: the scanner does flag a page with known violations", async ({ page }) => {
    await page.setContent(
      '<html lang="en"><body><img src="x.png"><button></button><input></body></html>',
    );
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const ids = results.violations.map((v) => v.id);
    expect(ids).toEqual(expect.arrayContaining(["image-alt", "button-name", "label"]));
  });

  test("the new portfolio form has no violations", async ({ page }) => {
    await page.goto("/portfolios/new");
    await expect(page.getByLabel("Ticker 1")).toBeVisible();
    await scan(page);
  });

  test("the empty dashboard has no violations", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("You have no portfolios yet.")).toBeVisible();
    await scan(page);
  });

  test("the populated dashboard, with an explanation open, has no violations", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("A11y", EXAMPLE);
    await page.reload();
    await waitForDashboard(page);
    await page.getByRole("button", { name: "Explain", exact: true }).click();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    await page.getByText("Figures used").click();
    await page.waitForLoadState("networkidle");
    await scan(page);
  });

  test("the correlation page has no violations", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("A11y", EXAMPLE);
    await page.goto("/correlation");
    await expect(page.getByRole("table", { name: "Correlation matrix" })).toBeVisible();
    await scan(page);
  });

  test("the exposures page has no violations", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("A11y", COVERED);
    await page.goto("/exposures");
    await expect(page.getByRole("table", { name: "Holdings by factor" })).toBeVisible();
    await scan(page);
  });

  test("the form can be completed with the keyboard alone", async ({ page }) => {
    await page.goto("/portfolios/new");
    await expect(page.getByLabel("Ticker 1")).toBeVisible();
    await page.getByLabel("Name").focus();
    await page.keyboard.press("Tab");
    await page.keyboard.type("NVDA");
    await page.keyboard.press("Tab");
    await page.keyboard.type("60");
    await page.keyboard.press("Tab"); // remove button
    await page.keyboard.press("Tab");
    await page.keyboard.type("AAPL");
    await page.keyboard.press("Tab");
    await page.keyboard.type("40");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
