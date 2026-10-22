import { expect, test } from "@playwright/test";
import {
  COVERED,
  EXAMPLE,
  createPortfolio,
  newSession,
  startUiSession,
  waitForDashboard,
} from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const RANK: Record<string, number> = { alert: 0, watch: 1, info: 2 };

test.describe("insights API", () => {
  test("returns plain-language findings sorted by severity, each with a link to where the detail lives", async ({
    playwright,
  }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "I", EXAMPLE);
    const r = await ctx.get(`/api/portfolios/${id}/insights`);
    expect(r.status()).toBe(200);
    const { insights } = (await r.json()) as { insights: Json[] };
    expect(insights.length).toBeGreaterThanOrEqual(5);
    const ranks = insights.map((i) => RANK[i.severity]!);
    expect(ranks).toEqual([...ranks].sort());
    for (const i of insights) {
      expect(["alert", "watch", "info"]).toContain(i.severity);
      expect(i.title.length).toBeGreaterThan(5);
      expect(i.detail.length).toBeGreaterThan(10);
      expect(i.href).toMatch(/^\//);
      expect(i.linkLabel.length).toBeGreaterThan(3);
    }
    const ids = insights.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        "hidden-concentration",
        "risk-driver",
        "drawdown",
        "latest-move",
        "correlation",
        "top-news",
      ]),
    );
  });

  test("falls back to position sizes when exposure data is missing, and explains why", async ({
    playwright,
  }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "Missing", EXAMPLE); // JPM has no exposure fixture
    const { insights } = (await (await ctx.get(`/api/portfolios/${id}/insights`)).json()) as {
      insights: Json[];
    };
    const h = insights.find((i) => i.id === "hidden-concentration")!;
    expect(h.detail).toContain("needs exposure data for every holding");
    expect(insights.find((i) => i.id === "top-force")).toBeUndefined();
  });

  test("compares sectors with hidden forces when every holding is covered, in numbers that match the exposures API", async ({
    playwright,
  }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "Covered", COVERED);
    const { insights } = (await (await ctx.get(`/api/portfolios/${id}/insights`)).json()) as {
      insights: Json[];
    };
    const x = (await (await ctx.get(`/api/portfolios/${id}/exposures`)).json()) as Json;
    const h = insights.find((i) => i.id === "hidden-concentration")!;
    expect(h.detail).toContain(`${x.concentration.effectiveSectors.toFixed(1)}`);
    expect(h.detail).toContain(`${x.concentration.effectiveFactors.toFixed(1)}`);
    // Few sectors but many forces: the reassuring version.
    expect(h.severity).toBe("info");
    expect(h.title).toContain("at least as spread");
  });

  test("its latest-move card agrees with the move endpoint", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "Move", EXAMPLE);
    const { insights } = (await (await ctx.get(`/api/portfolios/${id}/insights`)).json()) as {
      insights: Json[];
    };
    const m = (await (await ctx.get(`/api/portfolios/${id}/move`)).json()) as Json;
    const card = insights.find((i) => i.id === "latest-move")!;
    expect(card.detail).toBe(m.headline);
    expect(card.title).toBe(
      `Latest day: ${m.portfolioReturn >= 0 ? "+" : ""}${(m.portfolioReturn * 100).toFixed(2)}%`,
    );
  });

  test("needs a session, hides other sessions' portfolios and rejects bad ids", async ({
    playwright,
    request,
  }) => {
    expect(
      (await request.get("/api/portfolios/00000000-0000-4000-8000-000000000000/insights")).status(),
    ).toBe(401);
    const owner = await newSession(playwright);
    const id = await createPortfolio(owner, "Mine", EXAMPLE);
    expect(
      (await (await newSession(playwright)).get(`/api/portfolios/${id}/insights`)).status(),
    ).toBe(404);
    expect((await owner.get("/api/portfolios/not-a-uuid/insights")).status()).toBe(400);
    const thin = await createPortfolio(owner, "Thin", [
      { ticker: "NVDA", weightPct: 50 },
      { ticker: "TGT", weightPct: 50 },
    ]);
    expect((await owner.get(`/api/portfolios/${thin}/insights`)).status()).toBe(409);
  });
});

test.describe("insight cards on the dashboard", () => {
  test("show a severity word and shape, a title, a sentence and a working link", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Cards", EXAMPLE);
    await page.reload();
    await waitForDashboard(page);
    const api = (await (await page.request.get(`/api/portfolios/${id}/insights`)).json()) as {
      insights: Json[];
    };
    const cards = page.getByRole("list", { name: "Insights" }).getByRole("listitem");
    await expect(cards).toHaveCount(Math.min(6, api.insights.length));
    const first = cards.first();
    const top = api.insights[0]!;
    await expect(first).toContainText(top.title);
    await expect(first).toContainText(top.detail);
    await expect(first.getByRole("link", { name: top.linkLabel })).toHaveAttribute(
      "href",
      top.href,
    );
    const label = { alert: "Alert", watch: "Watch", info: "Info" }[
      top.severity as "alert" | "watch" | "info"
    ];
    await expect(first.getByText(new RegExp(`${label}$`)).first()).toBeVisible();
    // Each severity has its own symbol, so color is never the only cue.
    const symbols = await page
      .getByRole("list", { name: "Insights" })
      .locator("article span[aria-hidden='true']")
      .allTextContents();
    expect(new Set(symbols).size).toBeGreaterThanOrEqual(2);
  });

  test("a link takes you to the page that owns the detail", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Cards", COVERED);
    await page.reload();
    await waitForDashboard(page);
    await page.getByRole("link", { name: "See the exposure map" }).click();
    await expect(page).toHaveURL(/\/exposures$/);
    await expect(page.getByText("Hidden exposure map", { exact: true })).toBeVisible();
  });

  test("the Terminal links open the right section", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Cards", EXAMPLE);
    await page.reload();
    await waitForDashboard(page);
    await page.getByRole("link", { name: "Compare risk and weight" }).click();
    await expect(page).toHaveURL(/\/terminal#risk$/);
    await expect(page.getByRole("tab", { name: /Risk$/ })).toHaveAttribute("aria-selected", "true");
  });

  test("the latest-day card jumps to the day-move section", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Cards", EXAMPLE);
    await page.reload();
    await waitForDashboard(page);
    await page.getByRole("link", { name: "See what drove it" }).click();
    await expect(page).toHaveURL(/#move$/);
    await expect(page.locator("#move")).toBeInViewport();
  });
});
