import { expect, test } from "@playwright/test";
import { appAlert, mock, startUiSession, uniqueHoldings, waitForDashboard } from "./helpers";

test.describe("explain panel", () => {
  test.beforeEach(async () => {
    await mock.reset();
  });

  test("shows a grounded explanation with citations, the figures used and the disclaimer", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Explained", uniqueHoldings());
    await page.reload();
    await waitForDashboard(page);

    await expect(
      page.getByText("A plain-English reading of the numbers on this page."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Explain", exact: true }).click();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();

    const panel = page
      .getByText("Explain this portfolio")
      .locator("xpath=ancestor::*[@data-slot='card'][1]");
    await expect(panel).toContainText("Analysis window:");
    await expect(panel.locator("sup").first()).toHaveText("F1");
    await expect(panel.getByText(/not investment advice/)).toBeVisible();
    await expect(panel.getByText(/could not be verified/)).toHaveCount(0);

    // The citations point at real, listed figures.
    await panel.getByText("Figures used").click();
    await expect(panel.getByText(/F1 Analysis window:/)).toBeVisible();
    await expect(panel.getByText(/F6 Total return:/)).toBeVisible();
    // The figure the AI was given equals the one the API reports for the whole window.
    const pid = (
      (await (await page.request.get("/api/portfolios")).json()) as { portfolios: { id: string }[] }
    ).portfolios[0]!.id;
    const a = (await (
      await page.request.get(`/api/portfolios/${pid}/analytics?years=1`)
    ).json()) as { stats: { totalReturn: number } };
    const total = `${a.stats.totalReturn >= 0 ? "+" : ""}${(a.stats.totalReturn * 100).toFixed(1)}%`;
    await expect(panel.getByText(`Total return: ${total}`)).toBeVisible();
  });

  test("clicking Refresh returns the cached answer without another model call", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Cached", uniqueHoldings());
    await page.reload();
    await waitForDashboard(page);
    await page.getByRole("button", { name: "Explain", exact: true }).click();
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    expect(await mock.requests()).toHaveLength(1);
  });

  test("shows only the figures, with a notice, when the model's text cannot be verified", async ({
    page,
  }) => {
    await mock.setMode("ungrounded");
    const s = await startUiSession(page);
    await s.create("Fallback", uniqueHoldings());
    await page.reload();
    await waitForDashboard(page);
    await page.getByRole("button", { name: "Explain", exact: true }).click();
    await expect(
      page.getByText(
        "The written explanation could not be verified against the numbers, so only the figures are shown.",
      ),
    ).toBeVisible();
    await expect(page.getByText("99.99")).toHaveCount(0);
    await expect(
      page.getByText(/Analysis window: .* \[F1\]|Analysis window:/).first(),
    ).toBeVisible();
  });

  test("shows an error and recovers when the service fails", async ({ page }) => {
    await mock.setMode("error");
    const s = await startUiSession(page);
    await s.create("Error", uniqueHoldings());
    await page.reload();
    await waitForDashboard(page);
    await page.getByRole("button", { name: "Explain", exact: true }).click();
    await expect(appAlert(page)).toHaveText("Something went wrong");
    await expect(page.getByText("mock upstream failure")).toHaveCount(0);
    await mock.setMode("grounded");
    await page.getByRole("button", { name: "Explain", exact: true }).click();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    await expect(appAlert(page)).toHaveCount(0);
  });

  test("switching portfolios clears the previous explanation", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("First", uniqueHoldings());
    await s.create("Second", uniqueHoldings());
    await page.reload();
    await waitForDashboard(page);
    await page.getByRole("button", { name: "Explain", exact: true }).click();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    await page.getByLabel("Portfolio", { exact: true }).selectOption({ label: "First" });
    await waitForDashboard(page);
    await expect(page.getByRole("button", { name: "Explain", exact: true })).toBeVisible();
    await expect(
      page.getByText("A plain-English reading of the numbers on this page."),
    ).toBeVisible();
  });

  test("tells the user when the hourly limit is reached", async ({ page }) => {
    const s = await startUiSession(page);
    for (let i = 0; i < 10; i++) {
      const id = await s.create(`Limit ${i}`, uniqueHoldings());
      expect((await page.request.post(`/api/portfolios/${id}/explain`)).status()).toBe(200);
    }
    await s.create("Eleventh", uniqueHoldings());
    await page.reload();
    await waitForDashboard(page);
    await page.getByRole("button", { name: "Explain", exact: true }).click();
    await expect(appAlert(page)).toHaveText("Too many explanation requests. Try again later.");
  });

  test("a portfolio that cannot be analyzed offers no explain button", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Thin", [
      { ticker: "NVDA", weightPct: 50 },
      { ticker: "TGT", weightPct: 50 },
    ]);
    await page.reload();
    await expect(appAlert(page)).toContainText("shared history");
    await expect(page.getByRole("button", { name: "Explain", exact: true })).toHaveCount(0);
  });
});
