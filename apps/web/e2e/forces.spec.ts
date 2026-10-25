import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { COVERED, startUiSession } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// The fixture database has ten profiled companies, far fewer than the 60 needed for a daily cross-section, so these
// tests cover the honest "not enough data" path. The real-data suite checks the numbers.
test.describe("what the forces did", () => {
  test("says plainly when too few companies are profiled", async ({ page }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    const r = await page.request.get(`/api/portfolios/${id}/forces`);
    expect(r.status()).toBe(200);
    expect(await r.json()).toEqual({
      available: false,
      reason: "thin_universe",
      missingTickers: [],
    });
  });

  test("names the holdings that lack an exposure profile", async ({ page }) => {
    const s = await startUiSession(page);
    const id = await s.create("No profile", [
      { ticker: "XOM", weightPct: 50 },
      { ticker: "NVDA", weightPct: 50 },
    ]);
    const b = (await (await page.request.get(`/api/portfolios/${id}/forces`)).json()) as Json;
    expect(b).toMatchObject({ available: false, reason: "missing_exposures" });
    expect(b.missingTickers).toEqual(["XOM"]);
  });

  test("another session cannot read it, and a bad id is rejected", async ({ page }) => {
    const s = await startUiSession(page);
    const id = await s.create("Mine", COVERED);
    expect(
      (
        await page.request.get("/api/portfolios/00000000-0000-4000-8000-000000000000/forces")
      ).status(),
    ).toBe(404);
    expect((await page.request.get("/api/portfolios/not-an-id/forces")).status()).toBe(400);
    const other = await page.context().browser()!.newContext({ baseURL: page.url() });
    const stranger = await other.request.get(`/api/portfolios/${id}/forces`);
    expect([401, 404]).toContain(stranger.status());
    await other.close();
  });

  test("the page shows the message, is reachable from the menu, and has no accessibility violations", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Covered", COVERED);
    await page.goto("/forces");
    await expect(
      page.getByRole("heading", { name: "What the forces did", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("Not enough companies with exposure profiles")).toBeVisible();
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
    );
    const r = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(r.violations).toEqual([]);
  });
});
