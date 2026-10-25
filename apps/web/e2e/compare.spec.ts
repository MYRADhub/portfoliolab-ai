import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { COVERED, newSession, startUiSession } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const OTHER = [
  { ticker: "NVDA", weightPct: 50 },
  { ticker: "MSFT", weightPct: 30 },
  { ticker: "COST", weightPct: 20 },
];
const returnsOf = (c: number[]) => c.slice(1).map((v, i) => v / c[i]! - 1);
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const sd = (x: number[]) =>
  Math.sqrt(x.reduce((a, b) => a + (b - mean(x)) ** 2, 0) / (x.length - 1));

test.describe("compare API", () => {
  test("every figure matches an independent calculation from the returned curves", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    const a = await s.create("Covered", COVERED);
    const b = await s.create("Other", OTHER);
    const r = await page.request.get(`/api/compare?a=${a}&b=${b}`);
    expect(r.status()).toBe(200);
    const c = (await r.json()) as Json;
    expect(c.a).toMatchObject({ id: a, name: "Covered", holdings: 4 });
    expect(c.b).toMatchObject({ id: b, name: "Other", holdings: 3 });
    const n = c.window.tradingDays;
    expect(c.curves.dates.length).toBe(n + 1);

    for (const [side, curve] of [
      ["a", c.curves.a],
      ["b", c.curves.b],
    ] as const) {
      const r2 = returnsOf(curve);
      const peak = curve.reduce(
        (acc: { p: number; dd: number }, v: number) => ({
          p: Math.max(acc.p, v),
          dd: Math.min(acc.dd, v / Math.max(acc.p, v) - 1),
        }),
        { p: curve[0], dd: 0 },
      );
      expect(c[side].annualReturn).toBeCloseTo((curve.at(-1) / 100) ** (252 / n) - 1, 9);
      expect(c[side].volatility).toBeCloseTo(sd(r2) * Math.sqrt(252), 9);
      expect(c[side].maxDrawdown).toBeCloseTo(peak.dd, 9);
      expect(c[side].sharpe).toBeCloseTo((mean(r2) * 252) / (sd(r2) * Math.sqrt(252)), 9);
      expect(Number.isFinite(c[side].beta)).toBe(true);
      expect(c[side].effectiveFactors).toBeGreaterThan(0);
    }
    const [ra, rb] = [returnsOf(c.curves.a), returnsOf(c.curves.b)];
    const [ma, mb] = [mean(ra), mean(rb)];
    const cov = ra.reduce((acc, x, i) => acc + (x - ma) * (rb[i]! - mb), 0);
    expect(c.correlation).toBeCloseTo(cov / ((n - 1) * sd(ra) * sd(rb)), 9);
  });

  test("overlap counts the smaller weight of each shared company", async ({ page }) => {
    const s = await startUiSession(page);
    const a = await s.create("Covered", COVERED);
    const b = await s.create("Other", OTHER);
    const c = (await (await page.request.get(`/api/compare?a=${a}&b=${b}`)).json()) as Json;
    // shared: NVDA (40% vs 50%) and MSFT (20% vs 30%); AMZN and AAPL are only in the first, COST only in the second
    expect(c.overlap.shared.map((x: Json) => [x.ticker, x.a, x.b])).toEqual([
      ["NVDA", 0.4, 0.5],
      ["MSFT", 0.2, 0.3],
    ]);
    expect(c.overlap.sharedWeight).toBeCloseTo(0.6, 12);
    expect(c.differences.length).toBeGreaterThanOrEqual(4);
    expect(c.differences.join(" ")).toContain("60% of the money sits in companies both hold.");
    expect(c.differences[0]).toContain("Other returned");
  });

  test("validates the request and keeps portfolios private", async ({ page, playwright }) => {
    const s = await startUiSession(page);
    const a = await s.create("Covered", COVERED);
    const b = await s.create("Other", OTHER);
    expect((await page.request.get(`/api/compare?a=${a}&b=${a}`)).status()).toBe(400);
    expect((await page.request.get(`/api/compare?a=${a}`)).status()).toBe(400);
    expect((await page.request.get(`/api/compare?a=nope&b=${b}`)).status()).toBe(400);
    const stranger = await newSession(playwright);
    expect((await stranger.get(`/api/compare?a=${a}&b=${b}`)).status()).toBe(404);
  });
});

test.describe("compare page", () => {
  test("needs two portfolios", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Only one", COVERED);
    await page.goto("/compare");
    await expect(page.getByText(/Comparing needs at least two portfolios/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Add a portfolio" })).toBeVisible();
  });

  test("shows the table, the differences, the chart and the overlap, and updates when the choice changes", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Covered", COVERED);
    await s.create("Other", OTHER);
    await s.create("Third", [
      { ticker: "AMZN", weightPct: 60 },
      { ticker: "AAPL", weightPct: 40 },
    ]);
    await page.goto("/compare");
    await page.getByLabel("First portfolio").selectOption({ label: "Covered" });
    await page.getByLabel("Second portfolio").selectOption({ label: "Other" });
    const table = page.getByRole("table", { name: "Side by side" });
    await expect(table).toContainText("Yearly return");
    await expect(table).toContainText("Effective forces");
    await expect(table.getByRole("row", { name: /^Holdings/ })).toContainText("4");
    await expect(
      page.getByRole("list", { name: "Differences" }).locator("li").first(),
    ).toContainText("returned");
    await expect(page.locator(".recharts-wrapper")).toHaveCount(1);
    await expect(page.getByTestId("overlap-summary")).toContainText("60% of the money");
    await expect(
      page.getByRole("table", { name: "Shared holdings" }).locator("tbody tr"),
    ).toHaveCount(2);

    await page.getByLabel("Second portfolio").selectOption({ label: "Third" });
    await expect(page.getByTestId("overlap-summary")).toContainText(
      "of the money is in companies both hold",
    );
    await expect(
      page.getByRole("table", { name: "Shared holdings" }).locator("tbody tr"),
    ).toHaveCount(2); // AMZN and AAPL are in both Covered and Third
    await expect(table).toContainText("Third");
  });

  test("refuses to compare a portfolio with itself and has no accessibility violations", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Covered", COVERED);
    await s.create("Other", OTHER);
    await page.goto("/compare");
    await page.getByLabel("First portfolio").selectOption({ label: "Covered" });
    await page.getByLabel("Second portfolio").selectOption({ label: "Other" });
    await expect(page.getByRole("table", { name: "Side by side" })).toBeVisible();
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
    );
    const r = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);
    await page.getByLabel("Second portfolio").selectOption({ label: "Covered" });
    await expect(
      page.getByRole("alert").filter({ hasText: "Choose two different portfolios." }),
    ).toBeVisible();
  });
});
