import { expect, test } from "@playwright/test";
import { COVERED, EXAMPLE, startUiSession } from "./helpers";

test.describe("exposures page", () => {
  test("says no exposure data exists when nothing is loaded for the holdings", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Energy and banks", [
      { ticker: "XOM", weightPct: 60 },
      { ticker: "JPM", weightPct: 40 },
    ]);
    await page.goto("/exposures");
    await expect(
      page.getByText("Exposure data has not been loaded yet, so there is nothing to analyze."),
    ).toBeVisible();
    await expect(page.getByText("Effective factors")).toHaveCount(0);
  });

  test("names the holdings that lack exposure data instead of showing a partial analysis", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Mega caps", EXAMPLE);
    await page.goto("/exposures");
    await expect(page.getByText(/Exposure profiles are missing for:/)).toContainText("JPM");
    await expect(page.getByText(/needs every holding covered/)).toBeVisible();
    await expect(page.getByRole("table", { name: "Holdings by factor" })).toHaveCount(0);
  });

  test("shows concentration cards, loadings, a heatmap and shared risks for a covered portfolio", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    await page.goto("/exposures");
    await expect(page.getByText("Effective sectors")).toBeVisible();

    const x = (await (await page.request.get(`/api/portfolios/${id}/exposures`)).json()) as {
      concentration: {
        effectiveSectors: number;
        effectiveFactors: number;
        factorHhi: number;
        topFactorShare: number;
      };
      factors: { name: string; slug: string }[];
      pairs: unknown[];
    };
    await expect(
      page.getByText(x.concentration.effectiveSectors.toFixed(1), { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(x.concentration.effectiveFactors.toFixed(1), { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(x.concentration.factorHhi.toFixed(3), { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(`${Math.round(x.concentration.topFactorShare * 100)}%`, { exact: true }),
    ).toBeVisible();
    // The product's central contrast: the same weights look concentrated by sector and spread by factor.
    expect(x.concentration.effectiveSectors).toBeLessThan(x.concentration.effectiveFactors);

    await expect(page.getByText("Portfolio factor loadings (net)")).toBeVisible();
    await expect(page.locator(".recharts-surface")).toHaveCount(1);

    const heat = page.getByRole("table", { name: "Holdings by factor" });
    await expect(heat.locator("tbody tr")).toHaveCount(4);
    await expect(heat.locator("thead th[scope='col']")).toHaveCount(5);
    const nvda = heat.getByRole("row", { name: /NVDA/ });
    await expect(nvda).toContainText("+3"); // AI infrastructure capex
    await expect(nvda).toContainText("-3"); // Taiwan supply chain risk (negative direction)
    // Every cell exposes its confidence and rationale on hover.
    await expect(nvda.locator("td[title*='confidence 80%']").first()).toBeVisible();
    await expect(nvda.locator("td[title*='e2e fixture']").first()).toBeVisible();

    // Shared risks use factor names, never raw slugs, and cover all six pairs.
    const shared = page
      .getByText("Shared risks between holdings")
      .locator("xpath=ancestor::*[@data-slot='card'][1]");
    await expect(shared.getByRole("row")).toHaveCount(1 + x.pairs.length);
    await expect(shared).toContainText("Interest rates");
    await expect(shared).not.toContainText("ai_capex");
    await expect(shared).not.toContainText("taiwan,");
    await expect(
      page.getByText(/Exposure scores are judgments with stated confidence, not measurements/),
    ).toBeVisible();
  });

  test("shows the empty state without portfolios", async ({ page }) => {
    await page.goto("/exposures");
    await expect(page.getByText("You have no portfolios yet.")).toBeVisible();
  });
});
