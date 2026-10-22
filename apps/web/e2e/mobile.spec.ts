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
  test("the navigation is a top bar and every link stays reachable", async ({ page }) => {
    await page.goto("/dashboard");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav).toBeVisible();
    const box = await nav.boundingBox();
    const main = await page.getByRole("main").boundingBox();
    expect(box!.y).toBeLessThan(main!.y); // nav sits above the content, not beside it
    expect(main!.width).toBeGreaterThan(300);
    // All five links are on screen at once, with no horizontal scrolling needed.
    const vw = page.viewportSize()!.width;
    for (const name of [
      "Dashboard",
      "Terminal",
      "Exposures",
      "Correlation",
      "News",
      "Research",
      "Guide",
    ]) {
      const b = await nav.getByRole("link", { name }).boundingBox();
      expect(b, name).not.toBeNull();
      expect(b!.x, name).toBeGreaterThanOrEqual(0);
      expect(b!.x + b!.width, `${name} fits in the viewport`).toBeLessThanOrEqual(vw);
    }
    await noPageOverflow(page);
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
