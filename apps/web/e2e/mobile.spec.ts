import { expect, test, type Page } from "@playwright/test";
import { COVERED, EXAMPLE, holdingsSnapshot, startUiSession, waitForDashboard } from "./helpers";

async function noPageOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, "page is wider than the viewport").toBeLessThanOrEqual(innerWidth);
}

test.describe("mobile layout", () => {
  test("the navigation folds behind a menu button, stays reachable, and closes after a choice", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const nav = page.getByRole("navigation", { name: "Primary" });
    const menu = page.getByRole("button", { name: "Open menu" });
    // closed at first, so the page starts on the first screen
    await expect(nav).toBeHidden();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    const main = await page.getByRole("main").boundingBox();
    expect(main!.y).toBeLessThan(200);
    expect(main!.width).toBeGreaterThan(300);

    await menu.click();
    await expect(nav).toBeVisible();
    await expect(page.getByRole("button", { name: "Close menu" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const box = await nav.boundingBox();
    expect(box!.y).toBeLessThan(main!.y + 400); // opens above the content, not beside it
    const vw = page.viewportSize()!.width;
    for (const name of [
      "Dashboard",
      "Terminal",
      "Exposures",
      "Correlation",
      "Market comparison",
      "Compare",
      "Stress Lab",
      "Discovery",
      "Rebalance Lab",
      "Simulation",
      "News",
      "Reactions",
      "Research",
      "Report",
      "Guide",
    ]) {
      const b = await nav.getByRole("link", { name, exact: true }).boundingBox();
      expect(b, name).not.toBeNull();
      expect(b!.x, name).toBeGreaterThanOrEqual(0);
      expect(b!.x + b!.width, `${name} fits in the viewport`).toBeLessThanOrEqual(vw);
    }
    await noPageOverflow(page);

    await nav.getByRole("link", { name: "Terminal", exact: true }).click();
    await expect(page).toHaveURL(/\/terminal$/);
    await expect(nav).toBeHidden(); // choosing a page closes the menu
    await expect(page.getByRole("heading", { name: "Terminal", level: 1 })).toBeVisible();
  });

  test("the menu button opens and closes the menu", async ({ page }) => {
    await page.goto("/dashboard");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(nav).toBeVisible();
    await page.getByRole("button", { name: "Close menu" }).click();
    await expect(nav).toBeHidden();
  });

  test("the form is usable at phone width", async ({ page }) => {
    await page.goto("/portfolios/new");
    await expect(page.getByLabel("Ticker 1")).toBeVisible();
    await noPageOverflow(page);
    await page.getByLabel("Ticker 1").fill("NVDA");
    await page.getByLabel("Weight 1").fill("60");
    await page.getByLabel("Ticker 2").fill("AAPL");
    await page.getByLabel("Weight 2").fill("40");
    await page.getByRole("button", { name: "Create portfolio" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await waitForDashboard(page);
    await noPageOverflow(page);
  });

  test("dashboard, correlation and exposures do not overflow the page; wide tables scroll inside their cards", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Mobile", COVERED);
    for (const path of [
      "/dashboard",
      "/terminal",
      "/correlation",
      "/exposures",
      "/news",
      "/guide",
    ]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await noPageOverflow(page);
    }
  });

  test("the dashboard, holdings snapshot and wide tables fit a phone without clipping", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Tables", COVERED);
    const vw = page.viewportSize()!.width;
    await page.goto("/dashboard");
    await waitForDashboard(page);
    const snapshot = holdingsSnapshot(page);
    await expect(snapshot.getByRole("listitem")).toHaveCount(4);
    for (const item of await snapshot.getByRole("listitem").all()) {
      const b = await item.boundingBox();
      expect(b!.x + b!.width, "snapshot rows fit the viewport").toBeLessThanOrEqual(vw);
    }
    await expect(snapshot.getByRole("listitem").filter({ hasText: "NVDA" })).toContainText("40%");
    for (const card of await page
      .getByRole("list", { name: "Insights" })
      .getByRole("listitem")
      .all()) {
      const b = await card.boundingBox();
      expect(b!.x + b!.width, "insight cards fit the viewport").toBeLessThanOrEqual(vw);
    }

    await page.goto("/exposures");
    const shared = page
      .getByText("Shared risks between holdings")
      .locator("xpath=ancestor::*[@data-slot='card'][1]");
    await expect(shared.getByRole("row")).toHaveCount(7);
    // Long factor lists wrap inside their cell instead of being cut off by the card edge.
    for (const cell of await shared.getByRole("cell").all()) {
      const b = await cell.boundingBox();
      if (b) expect(b.x + b.width).toBeLessThanOrEqual(vw);
    }
  });

  test("the explain button and result fit on a phone", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Mobile explain", EXAMPLE);
    await page.reload();
    await waitForDashboard(page);
    await page.getByRole("button", { name: "Explain", exact: true }).click();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    await noPageOverflow(page);
  });
});
