import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("guide", () => {
  test("has the five sections, a working in-page menu and plain-language content", async ({
    page,
  }) => {
    await page.goto("/guide");
    await expect(page.getByRole("heading", { name: "Guide", level: 1 })).toBeVisible();
    for (const h of [
      "Quick tour (5 minutes)",
      "Key ideas",
      "Reading the Terminal",
      "Glossary",
      "About the data",
    ]) {
      await expect(page.getByRole("heading", { name: h, level: 2 })).toBeVisible();
    }
    const menu = page.getByRole("navigation", { name: "On this page" });
    const hrefs = await menu
      .getByRole("link")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href")!));
    expect(hrefs).toEqual(["#tour", "#ideas", "#terminal", "#glossary", "#data"]);
    for (const h of hrefs) await expect(page.locator(h)).toHaveCount(1);
  });

  test("the quick tour links go to real pages", async ({ page }) => {
    await page.goto("/guide");
    const tour = page.locator("#tour");
    const hrefs = await tour
      .getByRole("link")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href")!));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/portfolios/new#samples",
        "/dashboard",
        "/terminal",
        "/exposures",
        "/correlation",
        "/news",
      ]),
    );
    for (const href of new Set(hrefs.filter((h) => h.startsWith("/")))) {
      const r = await page.request.get(href.split("#")[0]!);
      expect(r.status(), href).toBe(200);
    }
    await tour.getByRole("link", { name: "Load the sample portfolios" }).click();
    await expect(page).toHaveURL(/\/portfolios\/new#samples$/);
    await expect(page.getByRole("heading", { name: "Or start from a sample" })).toBeInViewport();
  });

  test("covers every key term the app uses, each with its own anchor", async ({ page }) => {
    await page.goto("/guide");
    const terms = [
      "gl-weight",
      "gl-rebalancing",
      "gl-volatility",
      "gl-sharpe",
      "gl-drawdown",
      "gl-var",
      "gl-es",
      "gl-correlation",
      "gl-diversification-ratio",
      "gl-contribution",
      "gl-factor",
      "gl-hhi",
    ];
    for (const id of terms) await expect(page.locator(`#${id} dt`), id).toHaveCount(1);
    const ideas = [
      "idea-hidden-risk",
      "idea-sector-vs-factor",
      "idea-correlation-vs-exposure",
      "idea-signal-noise",
      "idea-relevance",
      "idea-numbers-first",
    ];
    for (const id of ideas) await expect(page.locator(`#${id}`), id).toHaveCount(1);
  });

  test("a deep link scrolls to its term", async ({ page }) => {
    await page.goto("/guide#gl-var");
    await expect(page.locator("#gl-var")).toBeInViewport();
    await expect(page.locator("#gl-var")).toContainText("A bad-day marker");
  });

  test("is honest about demo data and not being advice", async ({ page }) => {
    await page.goto("/guide");
    const data = page.locator("#data");
    await expect(data).toContainText("demo data");
    await expect(data).toContainText("not investment advice");
    await expect(data).toContainText("Exposure scores are judgments");
  });

  test("works without a session and has no accessibility violations", async ({ page }) => {
    await page.goto("/guide");
    await expect(page.getByRole("heading", { name: "Guide", level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const summary = results.violations.map(
      (v) => `${v.id} (${v.impact}): ${v.nodes[0]?.html.slice(0, 120)}`,
    );
    expect(summary, summary.join("\n")).toEqual([]);
  });
});
