import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { appAlert, BASE, newSession, startUiSession } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const post = (page: import("@playwright/test").Page, ticker: string) =>
  page.request.post("/api/watchlist", { data: { ticker } });

test.describe("watchlist API", () => {
  test("starts empty, adds in order, ignores repeats and remembers case", async ({ page }) => {
    await startUiSession(page);
    expect(await (await page.request.get("/api/watchlist")).json()).toMatchObject({
      items: [],
      alerts: [],
      max: 30,
    });
    expect((await post(page, "nvda")).status()).toBe(201);
    await post(page, "AAPL");
    const again = (await (await post(page, "NVDA")).json()) as Json;
    expect(again.items.map((i: Json) => i.ticker)).toEqual(["NVDA", "AAPL"]);
  });

  test("reports figures that match the company's own price history", async ({ page }) => {
    await startUiSession(page);
    await post(page, "NVDA");
    const w = (await (await page.request.get("/api/watchlist")).json()) as Json;
    const r = (await (await page.request.get("/api/research/NVDA")).json()) as Json;
    const item = w.items[0];
    const closes = (r.prices as Json[]).map((p) => p.close as number);
    const last = closes.at(-1)!;
    expect(item.signals.last).toBeCloseTo(last, 9);
    expect(item.signals.d1).toBeCloseTo(last / closes.at(-2)! - 1, 9);
    expect(item.signals.d5).toBeCloseTo(last / closes.at(-6)! - 1, 9);
    expect(item.signals.high52).toBeCloseTo(Math.max(...closes.slice(-252)), 9);
    expect(item.signals.fromHigh).toBeCloseTo(last / item.signals.high52 - 1, 9);
    expect(item.asOf).toBe(r.stats.asOf);
    for (const a of item.alerts) expect(a.text.length).toBeGreaterThan(10);
  });

  test("removes a company, and removing one that is not listed is harmless", async ({ page }) => {
    await startUiSession(page);
    await post(page, "NVDA");
    await post(page, "AAPL");
    expect((await page.request.delete("/api/watchlist/nvda")).status()).toBe(204);
    expect((await page.request.delete("/api/watchlist/NVDA")).status()).toBe(204);
    const w = (await (await page.request.get("/api/watchlist")).json()) as Json;
    expect(w.items.map((i: Json) => i.ticker)).toEqual(["AAPL"]);
  });

  test("rejects unknown and malformed tickers", async ({ page }) => {
    await startUiSession(page);
    expect((await post(page, "ZZZZ")).status()).toBe(404);
    expect((await post(page, "bad ticker!")).status()).toBe(400);
    expect((await page.request.delete("/api/watchlist/ZZZZ")).status()).toBe(404);
    expect(
      (
        await page.request.post("/api/watchlist", {
          data: "not json{",
          headers: { "content-type": "application/json" },
        })
      ).status(),
    ).toBe(400);
  });

  test("lists are private to each session", async ({ page, playwright }) => {
    await startUiSession(page);
    await post(page, "NVDA");
    const other = await newSession(playwright);
    const w = (await (await other.get("/api/watchlist")).json()) as Json;
    expect(w.items).toEqual([]);
    await other.dispose();
  });

  test("needs a session", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: BASE });
    expect((await ctx.get("/api/watchlist")).status()).toBe(401);
    await ctx.dispose();
  });
});

test.describe("watchlist page", () => {
  test("adds and removes companies, shows alerts or says there are none, and is accessible", async ({
    page,
  }) => {
    await startUiSession(page);
    await page.goto("/watchlist");
    await expect(page.getByRole("heading", { name: "Watchlist", level: 1 })).toBeVisible();
    await expect(page.getByText("Nothing on your watchlist yet")).toBeVisible();

    await page.getByLabel("Company ticker").fill("nvda");
    await page.getByRole("button", { name: "Add to watchlist" }).click();
    const table = page.getByRole("table", { name: "Watchlist" });
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(table).toContainText("NVDA");
    await page.getByLabel("Company ticker").fill("AAPL");
    await page.getByRole("button", { name: "Add to watchlist" }).click();
    await expect(table.locator("tbody tr")).toHaveCount(2);
    await expect(page.getByText("2 of 30 used")).toBeVisible();

    const alerts = page.getByRole("list", { name: "Alerts" });
    await expect(alerts.or(page.getByTestId("no-alerts"))).toBeVisible();

    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
    );
    const r = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(r.violations).toEqual([]);

    await page.getByRole("button", { name: "Remove NVDA" }).click();
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole("table", { name: "Watchlist" }).locator("tbody tr")).toHaveCount(1);
  });

  test("shows a clear error for an unknown ticker", async ({ page }) => {
    await startUiSession(page);
    await page.goto("/watchlist");
    await page.getByLabel("Company ticker").fill("ZZZZ");
    await page.getByRole("button", { name: "Add to watchlist" }).click();
    await expect(appAlert(page).filter({ hasText: "Company not found" })).toBeVisible();
  });
});
