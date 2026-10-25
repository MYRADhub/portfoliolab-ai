import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { COVERED, startUiSession } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test.describe("report", () => {
  test("is a one-page summary built from the same numbers as the rest of the app", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Quarterly review", COVERED);
    const t = (await (await page.request.get(`/api/portfolios/${id}/terminal`)).json()) as Json;
    const b = (await (await page.request.get(`/api/portfolios/${id}/benchmark`)).json()) as Json;
    await page.goto("/report");
    const report = page.getByRole("article", { name: "Portfolio report" });
    await expect(report.getByTestId("report-title")).toHaveText("Quarterly review");
    for (const h of [
      "Key figures",
      "What to know",
      "Holdings",
      "Hidden concentration",
      "Against the market",
      "Stress scenarios (illustrative)",
    ])
      await expect(report.getByRole("heading", { name: h, level: 2 })).toBeVisible();

    const rows = report.getByRole("table", { name: "Report holdings" }).locator("tbody tr");
    await expect(rows).toHaveCount(4);
    await expect(rows.first()).toContainText(t.holdings[0].ticker);
    await expect(rows.first()).toContainText(`${(t.holdings[0].weight * 100).toFixed(1)}%`);
    await expect(report).toContainText(`Beta ${b.stats.beta.toFixed(2)}`);
    await expect(report).toContainText(`${t.window.tradingDays} trading days`);
    await expect(report.getByText("Interest rates jump")).toBeVisible();
    await expect(report.getByText(/not investment advice/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeVisible();
    await expect(report.locator(".recharts-wrapper")).toHaveCount(1);
  });

  test("when printed, the navigation, controls and print button disappear but the report stays", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Quarterly review", COVERED);
    await page.goto("/report");
    const report = page.getByRole("article", { name: "Portfolio report" });
    await expect(report.getByTestId("report-title")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeHidden();
    await expect(page.getByRole("button", { name: /Export holdings/ })).toBeHidden();
    await expect(page.getByLabel("Portfolio", { exact: true })).toBeHidden();
    await expect(report).toBeVisible();
    // nothing is clipped: the document is as tall as the report, not limited to the window
    const { scrollHeight, clientHeight } = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    expect(scrollHeight).toBeGreaterThanOrEqual(clientHeight);
    const box = await report.boundingBox();
    expect(box!.height).toBeGreaterThan(400);
  });

  test("the print button opens the print dialog", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Quarterly review", COVERED);
    await page.addInitScript(() => {
      (window as unknown as { __printed: number }).__printed = 0;
      window.print = () => {
        (window as unknown as { __printed: number }).__printed++;
      };
    });
    await page.goto("/report");
    await page.getByRole("button", { name: "Print or save as PDF" }).click();
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(
      1,
    );
  });

  test("says what is missing instead of failing when exposure data is incomplete", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("No exposures", [
      { ticker: "XOM", weightPct: 60 },
      { ticker: "JPM", weightPct: 40 },
    ]);
    await page.goto("/report");
    const report = page.getByRole("article", { name: "Portfolio report" });
    await expect(
      report.getByText(/Exposure data is not available for every holding/),
    ).toBeVisible();
    await expect(report.getByText(/Stress tests need exposure data/)).toBeVisible();
    await expect(
      report.getByRole("table", { name: "Report holdings" }).locator("tbody tr"),
    ).toHaveCount(2);
  });

  test("has no accessibility violations", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Quarterly review", COVERED);
    await page.goto("/report");
    await expect(page.getByTestId("report-title")).toBeVisible();
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
    );
    const r = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);
  });
});
