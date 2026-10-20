import { expect, test } from "@playwright/test";
import { EXAMPLE, appAlert, startUiSession } from "./helpers";

type Corr = {
  tickers: string[];
  matrix: number[][];
  order: number[];
  averagePairwise: number;
  diversificationRatio: number;
  window: { tradingDays: number };
  stress: { averagePairwise: number; days: number } | null;
};

test.describe("correlation page", () => {
  test("renders the matrix, summary cards and portfolio correlations that match the API", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Corr", EXAMPLE);
    await page.goto("/correlation");
    await expect(page.getByRole("heading", { name: "Correlation" })).toBeVisible();
    const table = page.getByRole("table", { name: "Correlation matrix" });
    await expect(table).toBeVisible();

    const c = (await (
      await page.request.get(`/api/portfolios/${id}/correlation?window=1y`)
    ).json()) as Corr;
    await expect(page.getByText(`${c.window.tradingDays} trading days)`)).toBeVisible();
    // 5 column headers + 5 rows, diagonal cells read 1.00
    await expect(table.locator("thead th[scope='col']")).toHaveCount(5);
    await expect(table.locator("tbody tr")).toHaveCount(5);
    for (let k = 0; k < 5; k++) {
      const row = table.locator("tbody tr").nth(k);
      await expect(row.locator("td").nth(k)).toHaveText("1.00");
    }
    // The heatmap follows the clustered order returned by the API.
    const headers = await table.locator("thead th[scope='col']").allTextContents();
    expect(headers).toEqual(c.order.map((i) => c.tickers[i]));
    // Cell values equal the API matrix at 2 decimals.
    const firstRow = await table.locator("tbody tr").first().locator("td").allTextContents();
    expect(firstRow).toEqual(c.order.map((j) => c.matrix[c.order[0]!]![j]!.toFixed(2)));

    await expect(page.getByText("Average pairwise correlation", { exact: true })).toBeVisible();
    await expect(
      page.getByText(c.averagePairwise.toFixed(2), { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("Diversification ratio")).toBeVisible();
    await expect(page.getByText(c.diversificationRatio.toFixed(2), { exact: true })).toBeVisible();
    await expect(page.getByText("Average correlation on worst days")).toBeVisible();
    await expect(
      page.getByText(/Historical correlation is not the same as shared economic exposure/),
    ).toBeVisible();
    await expect(page.getByText("Correlation with the portfolio")).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(5 + 1 + 5 + 1); // matrix header+rows, then table header+rows
  });

  test("window buttons switch the data and show which window is active", async ({ page }) => {
    const s = await startUiSession(page);
    const id = await s.create("Corr", EXAMPLE);
    await page.goto("/correlation");
    const one = page.getByRole("button", { name: "1 year" });
    await expect(one).toHaveAttribute("aria-pressed", "true");
    const days = async (w: string) =>
      (
        (await (
          await page.request.get(`/api/portfolios/${id}/correlation?window=${w}`)
        ).json()) as Corr
      ).window.tradingDays;

    await page.getByRole("button", { name: "6 months" }).click();
    await expect(page.getByRole("button", { name: "6 months" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(one).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText(`${await days("6m")} trading days)`)).toBeVisible();
    // Six months is too short for a stress view, and the card says so instead of showing a number.
    await expect(page.getByText("needs a longer window")).toBeVisible();

    await page.getByRole("button", { name: "3 years" }).click();
    await expect(page.getByText(`${await days("3y")} trading days)`)).toBeVisible();
    await expect(page.getByText(/days \(worst 10% for the portfolio\)/)).toBeVisible();
  });

  test("a single-holding portfolio gets a clear message", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Solo", [{ ticker: "NVDA", weightPct: 100 }]);
    await page.goto("/correlation");
    await expect(appAlert(page)).toHaveText("Correlation needs at least 2 holdings");
    await expect(page.getByRole("table", { name: "Correlation matrix" })).toHaveCount(0);
  });

  test("shows the empty state without portfolios", async ({ page }) => {
    await page.goto("/correlation");
    await expect(page.getByText("You have no portfolios yet.")).toBeVisible();
  });
});
