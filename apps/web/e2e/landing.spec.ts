import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 400 && errors.push(`http ${r.status()}: ${r.url()}`));
  return errors;
}

test.describe("landing page", () => {
  test("is the front door: it explains the product and every way into the app works", async ({
    page,
  }) => {
    const errors = await trackErrors(page);
    const r = await page.goto("/");
    expect(r?.status()).toBe(200);
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Research the hidden risks in your portfolio" }),
    ).toBeVisible();
    await expect(page).toHaveTitle(/PortfolioLab/);
    for (const name of [
      "How you are doing, and why, in plain words",
      "News ranked by what it means for you, with the reasoning shown",
      "Answers you can check, figure by figure",
      "See how a company would change your portfolio before you add it",
      "Turn a conversation into slides you can present",
      "How answers are checked",
      "Where the numbers come from",
    ])
      await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText("Research, not investment advice.")).toBeVisible();

    // Every "Open the app" link goes to the dashboard.
    const links = page.getByRole("link", { name: "Open the app" });
    await expect(links).toHaveCount(3);
    for (const href of await links.evaluateAll((ls) => ls.map((l) => l.getAttribute("href"))))
      expect(href).toBe("/dashboard");

    // Section links move within the page.
    await page
      .getByRole("navigation", { name: "Landing" })
      .getByRole("link", { name: "Data" })
      .click();
    await expect(page).toHaveURL(/#data$/);
    await expect(
      page.getByRole("heading", { name: "Where the numbers come from" }),
    ).toBeInViewport();

    await links.last().click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("shows the screenshot for the current theme, each with a description", async ({ page }) => {
    await page.goto("/");
    const visible = page.locator("main figure img:visible");
    await expect(visible).toHaveCount(6);
    for (const img of await visible.all()) {
      expect((await img.getAttribute("alt"))!.length).toBeGreaterThan(40);
      // Below the fold the images load lazily, so bring each one into view first.
      await img.scrollIntoViewIfNeeded();
      await expect(img).toHaveJSProperty("complete", true);
      expect(await img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    }
    expect(await visible.first().getAttribute("src")).toContain("dashboard-light");

    await page.getByRole("button", { name: /Dark mode/ }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(await page.locator("main figure img:visible").first().getAttribute("src")).toContain(
      "dashboard-dark",
    );
  });

  test("the app's logo returns to the landing page", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: /^Home: PortfolioLab/ }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Research the hidden risks in your portfolio",
    );
  });

  for (const theme of ["light", "dark"]) {
    test(`has no accessibility violations in ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("pl-theme", t), theme);
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      const r = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
    });
  }
});
