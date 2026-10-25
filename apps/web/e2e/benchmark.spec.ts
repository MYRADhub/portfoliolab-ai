import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { COVERED, mock, newSession, startUiSession } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const returnsOf = (curve: number[]) => curve.slice(1).map((v, i) => v / curve[i]! - 1);
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;

test.describe("market comparison API", () => {
  test("matches an independent calculation from the returned curves", async ({ page }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    const r = await page.request.get(`/api/portfolios/${id}/benchmark`);
    expect(r.status()).toBe(200);
    const b = (await r.json()) as Json;
    expect(b.available).toBe(true);
    expect(b.benchmark.symbol).toBe("SPY");
    expect(b.curves.dates.length).toBe(b.window.tradingDays + 1);
    expect(b.curves.portfolio[0]).toBeCloseTo(100, 9);
    expect(b.curves.benchmark[0]).toBeCloseTo(100, 9);

    // recompute every statistic from the curves, in this test, not with the app's code
    const p = returnsOf(b.curves.portfolio);
    const m = returnsOf(b.curves.benchmark);
    const n = p.length;
    expect(b.stats.n).toBe(n);
    const [mp, mm] = [mean(p), mean(m)];
    const cov = p.reduce((a, x, i) => a + (x - mp) * (m[i]! - mm), 0);
    const varM = m.reduce((a, x) => a + (x - mm) ** 2, 0);
    const varP = p.reduce((a, x) => a + (x - mp) ** 2, 0);
    const beta = cov / varM;
    expect(b.stats.beta).toBeCloseTo(beta, 9);
    expect(b.stats.alpha).toBeCloseTo((mp - beta * mm) * 252, 9);
    expect(b.stats.correlation).toBeCloseTo(cov / Math.sqrt(varM * varP), 9);
    expect(b.stats.rSquared).toBeCloseTo(b.stats.correlation ** 2, 9);
    const active = p.map((x, i) => x - m[i]!);
    const ma = mean(active);
    const te = Math.sqrt(active.reduce((a, x) => a + (x - ma) ** 2, 0) / (n - 1)) * Math.sqrt(252);
    expect(b.stats.trackingError).toBeCloseTo(te, 9);
    const ann = (curve: number[]) => (curve.at(-1)! / 100) ** (252 / n) - 1;
    expect(b.stats.activeReturn).toBeCloseTo(ann(b.curves.portfolio) - ann(b.curves.benchmark), 9);
    expect(b.stats.informationRatio).toBeCloseTo(b.stats.activeReturn / te, 9);
    const side = (sign: number) => {
      const idx = m.map((x, i) => (x * sign > 0 ? i : -1)).filter((i) => i >= 0);
      return mean(idx.map((i) => p[i]!)) / mean(idx.map((i) => m[i]!));
    };
    expect(b.stats.upCapture).toBeCloseTo(side(1), 9);
    expect(b.stats.downCapture).toBeCloseTo(side(-1), 9);
    expect(b.stats.battingAverage).toBeCloseTo(p.filter((x, i) => x > m[i]!).length / n, 12);
  });

  test("calendar-year returns compound to the whole-period growth, and rolling beta is finite and dated", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    const b = (await (await page.request.get(`/api/portfolios/${id}/benchmark`)).json()) as Json;
    const growth = (k: "portfolio" | "benchmark") =>
      b.years.reduce((a: number, y: Json) => a * (1 + y[k]), 1);
    expect(growth("portfolio")).toBeCloseTo(b.curves.portfolio.at(-1) / 100, 9);
    expect(growth("benchmark")).toBeCloseTo(b.curves.benchmark.at(-1) / 100, 9);
    expect(b.years.map((y: Json) => y.year)).toEqual([...b.years.map((y: Json) => y.year)].sort());
    expect(b.years[0].partial).toBe(true);
    expect(b.years.at(-1).partial).toBe(true);
    expect(b.rollingBeta.length).toBeGreaterThan(300);
    expect(
      b.rollingBeta.every((r: Json) => Number.isFinite(r.value) && b.curves.dates.includes(r.date)),
    ).toBe(true);
  });

  test("is private to the session and rejects bad ids", async ({ page, playwright }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    const other = await newSession(playwright);
    expect((await other.get(`/api/portfolios/${id}/benchmark`)).status()).toBe(404);
    expect((await page.request.get("/api/portfolios/not-a-uuid/benchmark")).status()).toBe(400);
  });
});

test.describe("market comparison page", () => {
  test.beforeEach(async () => {
    await mock.reset();
  });

  test("shows a plain-language reading, the figures, both charts and the year table", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    const b = (await (await page.request.get(`/api/portfolios/${id}/benchmark`)).json()) as Json;
    await page.goto("/benchmark");
    await expect(page.getByRole("heading", { name: "Market comparison", level: 1 })).toBeVisible();
    await expect(page.getByTestId("beta-reading")).toContainText(
      `your portfolio typically moved ${b.stats.beta.toFixed(2)}%`,
    );
    const stats = page.getByRole("group", { name: "Market comparison" });
    await expect(stats).toContainText("Beta");
    await expect(stats).toContainText(b.stats.beta.toFixed(2));
    await expect(stats).toContainText("Down capture");
    await expect(page.locator(".recharts-wrapper")).toHaveCount(2);
    const table = page.getByRole("table", { name: "Calendar-year returns" });
    await expect(table.locator("tbody tr")).toHaveCount(b.years.length);
    await expect(table).toContainText("(part year)");
  });

  test("explains the comparison in plain English, grounded in its own figures", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    await page.goto("/benchmark");
    await page.getByRole("button", { name: "Explain this comparison" }).click();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    await expect(page.locator("sup").first()).toHaveText("F1");
    const r = (await (
      await page.request.post(`/api/portfolios/${id}/explain-tool`, { data: { tool: "benchmark" } })
    ).json()) as Json;
    expect(r.facts.map((f: Json) => f.label)).toEqual(
      expect.arrayContaining([
        "Beta",
        "Tracking error",
        "Share of the market's down days captured",
      ]),
    );
    const b = (await (await page.request.get(`/api/portfolios/${id}/benchmark`)).json()) as Json;
    expect(r.facts.find((f: Json) => f.label === "Beta").text).toBe(b.stats.beta.toFixed(2));
  });

  test("has no accessibility violations", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Covered", COVERED);
    await page.goto("/benchmark");
    await expect(page.getByTestId("beta-reading")).toBeVisible();
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
    );
    const r = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);
  });
});
