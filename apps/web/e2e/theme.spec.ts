import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { COVERED, EXAMPLE, startUiSession } from "./helpers";

const isDark = (page: Page) =>
  page.evaluate(() => document.documentElement.classList.contains("dark"));
const toggle = (page: Page) => page.getByRole("button", { name: /^Dark mode/ });
const bodyColor = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe("theme", () => {
  test("the toggle lives in the sidebar, starts off, and announces its state", async ({ page }) => {
    await page.goto("/dashboard");
    const nav = page.locator("aside");
    await expect(nav.getByRole("button", { name: "Dark mode: off" })).toBeVisible();
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    expect(await isDark(page)).toBe(false);
    await toggle(page).click();
    await expect(nav.getByRole("button", { name: "Dark mode: on" })).toBeVisible();
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    expect(await isDark(page)).toBe(true);
    await toggle(page).click();
    expect(await isDark(page)).toBe(false);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  });

  test("one choice applies to every page and survives navigation and reloads", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Theme", EXAMPLE);
    await page.goto("/dashboard");
    const light = await bodyColor(page);
    await toggle(page).click();
    const dark = await bodyColor(page);
    expect(dark).not.toBe(light);
    expect(await page.evaluate(() => localStorage.getItem("pl-theme"))).toBe("dark");

    for (const path of [
      "/terminal",
      "/news",
      "/exposures",
      "/correlation",
      "/guide",
      "/research",
      "/portfolios/new",
      "/dashboard",
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await isDark(page), path).toBe(true);
      expect(await bodyColor(page), path).toBe(dark);
      await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    }
    // In-app navigation (no reload) keeps it too.
    await page.getByRole("link", { name: "News", exact: true }).click();
    await expect(page.getByRole("heading", { name: "News", level: 1 })).toBeVisible();
    expect(await isDark(page)).toBe(true);
    await page.reload();
    expect(await isDark(page)).toBe(true);
  });

  test("the Terminal does not change the theme when it opens or closes", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Theme", EXAMPLE);
    await page.goto("/terminal");
    await expect(page.getByRole("heading", { name: "Holdings monitor" })).toBeVisible();
    expect(await isDark(page)).toBe(false);
    await page.getByRole("link", { name: "Guide", exact: true }).click();
    expect(await isDark(page)).toBe(false);
  });

  test("with no saved choice the operating system preference is followed, and a saved choice wins over it", async ({
    browser,
  }) => {
    const darkCtx = await browser.newContext({ colorScheme: "dark" });
    const p1 = await darkCtx.newPage();
    await p1.goto("/dashboard");
    expect(await isDark(p1)).toBe(true);
    await expect(toggle(p1)).toHaveAttribute("aria-pressed", "true");
    await darkCtx.close();

    const ctx = await browser.newContext({ colorScheme: "dark" });
    await ctx.addInitScript(() => localStorage.setItem("pl-theme", "light"));
    const p2 = await ctx.newPage();
    await p2.goto("/dashboard");
    expect(await isDark(p2)).toBe(false);
    await ctx.close();

    const lightCtx = await browser.newContext({ colorScheme: "light" });
    const p3 = await lightCtx.newPage();
    await p3.goto("/dashboard");
    expect(await isDark(p3)).toBe(false);
    await lightCtx.close();
  });

  test("the theme is applied before the page paints, so there is no flash of the wrong theme", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => localStorage.setItem("pl-theme", "dark"));
    const page = await ctx.newPage();
    // Record the class the moment the document element exists after the head script ran.
    await page.addInitScript(() => {
      document.addEventListener(
        "DOMContentLoaded",
        () =>
          ((window as unknown as { __earlyDark: boolean }).__earlyDark =
            document.documentElement.classList.contains("dark")),
      );
    });
    await page.goto("/guide");
    expect(
      await page.evaluate(() => (window as unknown as { __earlyDark: boolean }).__earlyDark),
    ).toBe(true);
    await ctx.close();
  });

  test("still works when browser storage is blocked, for the current visit", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get: () => {
          throw new Error("blocked");
        },
      });
    });
    const page = await ctx.newPage();
    await page.goto("/guide");
    await toggle(page).click();
    expect(await isDark(page)).toBe(true);
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Dashboard" })
      .click();
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    expect(await isDark(page)).toBe(true); // lasts while the page stays open
    await ctx.close();
  });

  test("charts and cards change with the theme, not just the page background", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Theme", COVERED);
    await page.goto("/dashboard");
    await expect(page.getByText("Portfolio index (100 at the start)")).toBeVisible();
    const card = page
      .getByText("Portfolio index (100 at the start)")
      .locator("xpath=ancestor::*[@data-slot='card'][1]");
    const before = await card.evaluate((e) => getComputedStyle(e).backgroundColor);
    const textBefore = await page
      .locator(".recharts-cartesian-axis-tick-value")
      .first()
      .evaluate((e) => getComputedStyle(e).fill);
    await toggle(page).click();
    const after = await card.evaluate((e) => getComputedStyle(e).backgroundColor);
    const textAfter = await page
      .locator(".recharts-cartesian-axis-tick-value")
      .first()
      .evaluate((e) => getComputedStyle(e).fill);
    expect(after).not.toBe(before);
    expect(textAfter).not.toBe(textBefore);
  });

  for (const path of [
    "/dashboard",
    "/exposures",
    "/correlation",
    "/news",
    "/guide",
    "/portfolios/new",
    "/research",
    "/events",
  ]) {
    test(`${path} has no accessibility violations in the dark theme`, async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("pl-theme", "dark"));
      const s = await startUiSession(page);
      await s.create("A11y", COVERED);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
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
});
