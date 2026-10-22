import { expect, test } from "@playwright/test";
import { COVERED, EXAMPLE, newSession, startUiSession } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PAIR = [
  { ticker: "NVDA", weightPct: 60 },
  { ticker: "AAPL", weightPct: 40 },
];

test.describe("stress API", () => {
  test("computes a hand-checkable impact for a custom shock", async ({ page }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    const r = await page.request.post(`/api/portfolios/${id}/stress`, {
      data: { shocks: { rates: 1 } },
    });
    expect(r.status()).toBe(200);
    const b = (await r.json()) as Json;
    // rates exposure: NVDA -1, AAPL -1, MSFT -1, AMZN -2 -> 0.03 * -(0.4 + 0.3 + 0.2 + 0.2) = -3.3%
    expect(b.portfolioImpact).toBeCloseTo(-0.033, 10);
    expect(b.vulnerability).toBeCloseTo(3.3, 8);
    expect(b.touched).toBe(true);
    expect(b.holdings[0].ticker).toBe("NVDA"); // ordered by portfolio contribution: 0.4 * -3% beats 0.1 * -6%
    expect(b.reliability).toBeCloseTo(0.8, 10);
  });

  test("flips sign for the opposite shock and ignores factors the portfolio lacks", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    const down = (await (
      await page.request.post(`/api/portfolios/${id}/stress`, { data: { shocks: { rates: -1 } } })
    ).json()) as Json;
    expect(down.portfolioImpact).toBeCloseTo(0.033, 10);
    expect(down.vulnerability).toBe(0);
    const none = (await (
      await page.request.post(`/api/portfolios/${id}/stress`, {
        data: { shocks: { not_a_factor: 1 } },
      })
    ).json()) as Json;
    expect(none).toMatchObject({ touched: false, portfolioImpact: 0, ignored: ["not_a_factor"] });
  });

  test("rejects bad input and unknown scenarios", async ({ page }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    const post = (data: unknown) => page.request.post(`/api/portfolios/${id}/stress`, { data });
    expect((await post({})).status()).toBe(400);
    expect((await post({ shocks: { rates: 5 } })).status()).toBe(400);
    expect((await post({ preset: "nope" })).status()).toBe(400);
  });

  test("reports unavailable when holdings lack exposures, and hides other sessions' portfolios", async ({
    page,
    playwright,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Partial", EXAMPLE);
    const r = (await (
      await page.request.post(`/api/portfolios/${id}/stress`, { data: { shocks: { rates: 1 } } })
    ).json()) as Json;
    expect(r).toMatchObject({ available: false, reason: "missing_exposures" });
    expect(r.missingTickers).toContain("JPM");

    const other = await newSession(playwright);
    expect((await other.get(`/api/portfolios/${id}/stress`)).status()).toBe(404);
    expect((await other.get(`/api/portfolios/${id}/discovery`)).status()).toBe(404);
  });
});

test.describe("stress lab page", () => {
  test("moving a slider shows the estimated impact and tables", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Covered", COVERED);
    await page.goto("/stress");
    await expect(page.getByText("Choose a scenario or move a slider to begin.")).toBeVisible();
    await page.getByRole("slider", { name: "Interest rates" }).fill("1");
    await expect(page.getByTestId("stress-impact")).toHaveText("-3.30%");
    await expect(page.getByTestId("stress-vulnerability")).toContainText("3.3");
    const byHolding = page.getByRole("table", { name: "Impact by holding" });
    await expect(byHolding.locator("tbody tr")).toHaveCount(4);
    await expect(byHolding.locator("tbody tr").first()).toContainText("NVDA");
    await expect(page.getByText(/nothing here is a prediction or advice/)).toBeVisible();
  });

  test("resetting every slider returns to the empty state", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Covered", COVERED);
    await page.goto("/stress");
    const slider = page.getByRole("slider", { name: "China demand" });
    await slider.fill("0.5");
    await expect(page.getByTestId("stress-impact")).toBeVisible();
    await slider.fill("0");
    await expect(page.getByText("Choose a scenario or move a slider to begin.")).toBeVisible();
  });

  test("explains what is needed when exposures are missing", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Partial", EXAMPLE);
    await page.goto("/stress");
    await expect(page.getByText(/Stress tests need exposure profiles/)).toBeVisible();
    await expect(page.getByRole("slider")).toHaveCount(0);
  });
});

test.describe("discovery", () => {
  test("API ranks candidates by effective-factor gain and flags hedges", async ({ page }) => {
    const s = await startUiSession(page);
    const id = await s.create("Pair", PAIR);
    const r = (await (await page.request.get(`/api/portfolios/${id}/discovery`)).json()) as Json;
    expect(r.available).toBe(true);
    expect(r.weight).toBe(0.05);
    const tickers = r.candidates.map((c: Json) => c.ticker);
    expect(tickers).toEqual(expect.arrayContaining(["AMZN", "MSFT"]));
    expect(tickers).toHaveLength(8); // every other profiled company
    const deltas = r.candidates.map((c: Json) => c.deltaEffectiveFactors);
    expect(deltas[0]).toBeGreaterThanOrEqual(deltas[1]);
    expect(r.candidates.every((c: Json) => typeof c.hedge === "boolean")).toBe(true);
    // never suggests something already held
    expect(tickers).not.toContain("NVDA");
  });

  test("API validates the weight and the page lists candidates", async ({ page }) => {
    const s = await startUiSession(page);
    const id = await s.create("Pair", PAIR);
    expect((await page.request.get(`/api/portfolios/${id}/discovery?weight=0.9`)).status()).toBe(
      400,
    );
    await page.goto("/discovery");
    const table = page.getByRole("table", { name: "Research candidates" });
    await expect(table.locator("tbody tr")).toHaveCount(8);
    await expect(page.getByText(/not recommendations/)).toBeVisible();
    await page.getByRole("button", { name: "10%", exact: true }).click();
    await expect(page.getByRole("button", { name: "10%", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(table.locator("tbody tr")).toHaveCount(8);
  });

  test("filters candidates by sector", async ({ page }) => {
    const s = await startUiSession(page);
    const id = await s.create("Pair", PAIR);
    const all = (await (await page.request.get(`/api/portfolios/${id}/discovery`)).json()) as Json;
    expect(all.sectors.length).toBeGreaterThan(1);
    const sector = all.candidates.find((c: Json) => c.ticker === "COST").sector as string;
    const only = (await (
      await page.request.get(`/api/portfolios/${id}/discovery?sector=${encodeURIComponent(sector)}`)
    ).json()) as Json;
    expect(only.candidates.length).toBeGreaterThan(0);
    expect(only.candidates.every((c: Json) => c.sector === sector)).toBe(true);
    expect(only.candidates.length).toBeLessThan(all.candidates.length);
    expect(only.sectors).toEqual(all.sectors);

    await page.goto("/discovery");
    const rows = page.getByRole("table", { name: "Research candidates" }).locator("tbody tr");
    await expect(rows).toHaveCount(all.candidates.length);
    const total = all.candidates.length;
    await page.getByLabel("Sector filter").selectOption(sector);
    await expect(rows).toHaveCount(only.candidates.length);
    expect(only.candidates.length).toBeLessThan(total);
  });

  test("says what is missing when holdings lack exposures", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Partial", EXAMPLE);
    await page.goto("/discovery");
    await expect(page.getByText(/Discovery needs exposure profiles/)).toContainText("JPM");
  });
});
