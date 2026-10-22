import { expect, test } from "@playwright/test";
import { COVERED, EXAMPLE, startUiSession } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test.describe("exposures page", () => {
  test("says no exposure data exists when nothing is loaded for the holdings", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Energy and banks", [
      { ticker: "XOM", weightPct: 60 },
      { ticker: "JPM", weightPct: 40 },
    ]);
    await page.goto("/exposures");
    await expect(
      page.getByText("Exposure data has not been loaded yet, so there is nothing to analyze."),
    ).toBeVisible();
    await expect(page.getByText("Effective factors")).toHaveCount(0);
  });

  test("names the holdings that lack exposure data instead of showing a partial analysis", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Mega caps", EXAMPLE);
    await page.goto("/exposures");
    await expect(page.getByText(/Exposure profiles are missing for:/)).toContainText("JPM");
    await expect(page.getByText(/needs every holding covered/)).toBeVisible();
    await expect(page.getByRole("table", { name: "Holdings by factor" })).toHaveCount(0);
  });

  test("shows concentration cards, loadings, a heatmap and shared risks for a covered portfolio", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    await page.goto("/exposures");
    await expect(page.getByText("Effective sectors")).toBeVisible();

    const x = (await (await page.request.get(`/api/portfolios/${id}/exposures`)).json()) as {
      concentration: {
        effectiveSectors: number;
        effectiveFactors: number;
        factorHhi: number;
        topFactorShare: number;
      };
      factors: { name: string; slug: string }[];
      pairs: unknown[];
    };
    await expect(
      page.getByText(x.concentration.effectiveSectors.toFixed(1), { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(x.concentration.effectiveFactors.toFixed(1), { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(x.concentration.factorHhi.toFixed(3), { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(`${Math.round(x.concentration.topFactorShare * 100)}%`, { exact: true }),
    ).toBeVisible();
    // The product's central contrast: the same weights look concentrated by sector and spread by factor.
    expect(x.concentration.effectiveSectors).toBeLessThan(x.concentration.effectiveFactors);

    await expect(page.getByText("Portfolio factor loadings (net)")).toBeVisible();
    await expect(page.locator(".recharts-surface")).toHaveCount(1);

    const heat = page.getByRole("table", { name: "Holdings by factor" });
    await expect(heat.locator("tbody tr")).toHaveCount(4);
    await expect(heat.locator("thead th[scope='col']")).toHaveCount(5);
    const nvda = heat.getByRole("row", { name: /NVDA/ });
    await expect(nvda).toContainText("+3"); // AI infrastructure capex
    await expect(nvda).toContainText("-3"); // Taiwan supply chain risk (negative direction)
    // Every cell exposes its confidence and rationale on hover.
    await expect(nvda.locator("td[title*='confidence 80%']").first()).toBeVisible();
    await expect(nvda.locator("td[title*='e2e fixture']").first()).toBeVisible();

    // Shared risks use factor names, never raw slugs, and cover all six pairs.
    const shared = page
      .getByText("Shared risks between holdings")
      .locator("xpath=ancestor::*[@data-slot='card'][1]");
    await expect(shared.getByRole("row")).toHaveCount(1 + x.pairs.length);
    await expect(shared).toContainText("Interest rates");
    await expect(shared).not.toContainText("ai_capex");
    await expect(shared).not.toContainText("taiwan,");
    await expect(
      page.getByText(/Exposure scores are judgments with stated confidence, not measurements/),
    ).toBeVisible();
  });

  test("shows the empty state without portfolios", async ({ page }) => {
    await page.goto("/exposures");
    await expect(page.getByText("You have no portfolios yet.")).toBeVisible();
  });

  test("draws the hidden exposure map: one node per holding and force, one line per dependency", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Graph", COVERED);
    await page.goto("/exposures");
    const x = (await (await page.request.get(`/api/portfolios/${id}/exposures`)).json()) as Json;
    const map = page.getByRole("group", { name: "Hidden exposure map" });
    await expect(map).toBeVisible();
    await expect(map.getByRole("button")).toHaveCount(4 + x.factors.length); // four holdings plus the forces they touch
    await expect(map.locator("path")).toHaveCount(x.cells.length);
    await expect(
      page.getByText(/Green.*means the holding is helped when that force rises/),
    ).toBeVisible();
    // Helped dependencies are green and hurt ones red.
    const colors = await map
      .locator("path")
      .evaluateAll((els) => els.map((e) => e.getAttribute("stroke")));
    expect(colors.filter((c) => c === "var(--gain)")).toHaveLength(
      x.cells.filter((c: Json) => c.signed > 0).length,
    );
    expect(colors.filter((c) => c === "var(--loss)")).toHaveLength(
      x.cells.filter((c: Json) => c.signed < 0).length,
    );
  });

  test("every node has an accessible name that starts with its visible label and describes its connections", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Graph", COVERED);
    await page.goto("/exposures");
    const map = page.getByRole("group", { name: "Hidden exposure map" });
    for (const node of await map.getByRole("button").all()) {
      const name = (await node.getAttribute("aria-label"))!;
      const visible = (await node.locator("text").textContent())!.replace(/\s+/g, " ").trim();
      expect(name.startsWith(visible), `"${name}" should start with "${visible}"`).toBe(true);
    }
    await expect(map.getByRole("button", { name: /^NVDA 40%\./ })).toHaveAttribute(
      "aria-label",
      /AI infrastructure capex \(helped strongly\).*Taiwan supply chain risk \(hurt strongly\)/,
    );
  });

  test("hovering or focusing a name isolates its connections and leaving restores them", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Graph", COVERED);
    await page.goto("/exposures");
    const map = page.getByRole("group", { name: "Hidden exposure map" });
    await expect(map.getByRole("button").first()).toBeVisible();
    const strokeOpacities = () =>
      map
        .locator("path")
        .evaluateAll((els) => els.map((e) => Number(e.getAttribute("stroke-opacity"))));
    const nodeOpacity = (name: RegExp) =>
      map.getByRole("button", { name }).evaluate((e) => Number(e.getAttribute("opacity")));

    const all = await strokeOpacities();
    expect(new Set(all).size).toBe(1); // everything equally visible at rest

    await map.getByRole("button", { name: /^NVDA/ }).hover();
    const nvda = await strokeOpacities();
    expect(nvda.filter((o) => o > 0.5)).toHaveLength(4); // NVDA has four dependencies
    expect(nvda.filter((o) => o < 0.2).length).toBe(9);
    expect(await nodeOpacity(/^NVDA/)).toBe(1);
    expect(await nodeOpacity(/^MSFT/)).toBeLessThan(1); // MSFT's own lines are not NVDA's, so it fades
    expect(await nodeOpacity(/^AI infrastructure capex/)).toBe(1);

    await map.getByRole("button", { name: /^Interest rates/ }).focus();
    const rates = await strokeOpacities();
    expect(rates.filter((o) => o > 0.5)).toHaveLength(4); // every covered holding depends on rates

    // Leaving the graph and the node restores every line to equal visibility.
    await page.mouse.move(0, 0);
    await map.getByRole("button", { name: /^Interest rates/ }).blur();
    await expect.poll(async () => new Set(await strokeOpacities()).size).toBe(1);
    expect(await nodeOpacity(/^MSFT/)).toBe(1);
  });

  test("a node can be pinned with the keyboard and unpinned again", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Graph", COVERED);
    await page.goto("/exposures");
    const node = page
      .getByRole("group", { name: "Hidden exposure map" })
      .getByRole("button", { name: /^China demand/ });
    await node.focus();
    await page.keyboard.press("Enter");
    await expect(node).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Space");
    await expect(node).toHaveAttribute("aria-pressed", "false");
  });

  test("lists the forces shared by several holdings, which are the hidden links", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Graph", COVERED);
    await page.goto("/exposures");
    const shared = page.getByRole("list", { name: "Shared forces" });
    await expect(shared).toContainText("Interest rates");
    await expect(shared).toContainText("touches");
    const items = await shared.getByRole("listitem").allTextContents();
    expect(items.length).toBeGreaterThanOrEqual(3);
    for (const t of items) expect((t.match(/[A-Z]{2,5}/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
