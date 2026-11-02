import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { EXAMPLE, mock, newSession, startUiSession } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const SCAN_HOLDINGS = [{ ticker: "ADBE", weightPct: 100 }];

test.describe("news analysis", () => {
  test.beforeEach(async () => {
    await mock.reset();
  });

  test("the analysis API explains coverage, links, classification and the exact score", async ({
    page,
    playwright,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Radar", EXAMPLE);
    const radar = (await (await page.request.get(`/api/portfolios/${id}/radar`)).json()) as Json;
    const top = radar.items[0];
    expect(top.title).toBe("E2E Radar NVDA earnings miss");
    expect(top.outlets.length).toBeGreaterThanOrEqual(1);
    expect(radar.overview.byHolding[0].key).toBeDefined();

    const a = (await (
      await page.request.get(`/api/portfolios/${id}/news/${top.id}`)
    ).json()) as Json;
    expect(a.coverage).toHaveLength(2);
    expect(a.coverage[0].id).toBe(top.id);
    expect(a.links.map((l: Json) => l.ticker)).toContain("NVDA");
    expect(a.links.find((l: Json) => l.ticker === "NVDA").weight).toBeCloseTo(0.25, 10);
    expect(a.classifications[0].class).toBe("fundamental");
    // Fetched a moment apart, so freshness differs in the far decimals.
    expect(a.relevance.score).toBeCloseTo(top.relevance.score, 3);
    expect(a.relevance.steps.at(-1).label).toBe("Relevance");

    const other = await newSession(playwright);
    expect((await other.get(`/api/portfolios/${id}/news/${top.id}`)).status()).toBe(404);
    expect((await page.request.get(`/api/portfolios/${id}/news/99999999`)).status()).toBe(404);
  });

  test("a story card opens the reasoning behind its ranking", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Radar", EXAMPLE);
    await page.goto("/news");
    await page.getByRole("button", { name: "How we judged this" }).first().click();
    const panel = page.getByRole("region", { name: "How we judged this story" });
    await expect(panel).toContainText("Coverage: 2 articles");
    await expect(panel).toContainText("Which holdings it is about");
    await expect(panel).toContainText(/Relevance to you: \d+\.\d of 10/);
    await expect(panel).toContainText("How the market reacted");
    await expect(page.getByRole("region", { name: "News overview" })).toContainText(
      "Stories per holding",
    );
  });

  test("Scan now finds web news, classifies it, and shows how it was linked", async ({ page }) => {
    const s = await startUiSession(page);
    // Holdings no other news test uses: the scanned article stays in the shared test database.
    await s.create("Scan", SCAN_HOLDINGS);
    await page.goto("/news");
    await page.getByRole("button", { name: "Scan now" }).click();
    // Loading placeholders are status regions too; the scan's result is the one that says what was searched.
    const status = page.getByRole("status").filter({ hasText: "Searched" });
    await expect(status).toContainText("Searched the web", { timeout: 30_000 });
    await expect(status).toContainText("1 new");
    await expect(status).toContainText("1 classified");
    await expect(status).toContainText("only by the search that found them");
    const reqs = await mock.requests();
    expect(reqs.filter((r) => r.path === "/v1/responses#web_search").length).toBe(
      SCAN_HOLDINGS.length,
    );
    expect(reqs.some((r) => r.path === "/v1/responses#classify")).toBe(true);

    const card = page.getByRole("article").filter({ hasText: "E2E Web Result" });
    await expect(card).toContainText("example.com");
    await card.getByRole("button", { name: "How we judged this" }).click();
    const panel = card.getByRole("region", { name: "How we judged this story" });
    await expect(panel).toContainText("Found by searching for it");
    await expect(panel).toContainText("Decided by AI");
  });

  test("a story the scan left unclassified can be classified from its panel", async ({
    page,
    playwright,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Linde", [{ ticker: "LIN", weightPct: 100 }]);
    const radar = (await (await page.request.get(`/api/portfolios/${id}/radar`)).json()) as Json;
    const story = radar.items.find((i: Json) => i.title.startsWith("E2E Linde"));
    const other = await newSession(playwright);
    expect((await other.post(`/api/portfolios/${id}/news/${story.id}/classify`)).status()).toBe(
      404,
    );

    await page.goto("/news");
    const card = page.getByRole("article").filter({ hasText: "E2E Linde" });
    await card.getByRole("button", { name: "How we judged this" }).click();
    const panel = card.getByRole("region", { name: "How we judged this story" });
    await expect(panel).toContainText("Not classified yet");
    await panel.getByRole("button", { name: "Classify now" }).click();
    await expect(panel).toContainText("Decided by AI");
    await expect(panel.getByRole("button", { name: "Classify now" })).toHaveCount(0);
    const reqs = await mock.requests();
    expect(reqs.filter((r) => r.path === "/v1/responses#classify")).toHaveLength(1);
  });

  for (const theme of ["light", "dark"]) {
    test(`the news page with the reasoning open has no accessibility violations in ${theme}`, async ({
      page,
    }) => {
      await page.addInitScript((t) => localStorage.setItem("pl-theme", t), theme);
      const s = await startUiSession(page);
      await s.create("Radar", EXAMPLE);
      await page.goto("/news");
      await page.getByRole("button", { name: "How we judged this" }).first().click();
      await expect(page.getByRole("region", { name: "How we judged this story" })).toContainText(
        "Coverage",
      );
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
      const r = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);
    });
  }
});
