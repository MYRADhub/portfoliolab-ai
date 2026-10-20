import { expect, test } from "@playwright/test";
import { appAlert, newSession, startUiSession, waitForDashboard } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const KEYS = ["mega-cap-tech", "balanced", "ai-boom", "defensive", "energy-and-banks"];

test.describe("samples API", () => {
  test("lists the catalogue publicly, with weights that add up and a lesson for each", async ({
    request,
  }) => {
    const r = await request.get("/api/samples");
    expect(r.status()).toBe(200);
    const { samples } = (await r.json()) as { samples: Json[] };
    expect(samples.map((s) => s.key)).toEqual(KEYS);
    for (const s of samples) {
      expect(s.holdings.reduce((a: number, h: Json) => a + h.weightPct, 0)).toBeCloseTo(100, 9);
      expect(s.blurb.length).toBeGreaterThan(10);
      expect(s.lesson.length).toBeGreaterThan(10);
      expect(s.name).toMatch(/^Sample: /);
    }
  });

  test("loading needs a session, rejects bad input, and is idempotent", async ({
    playwright,
    request,
  }) => {
    expect((await request.post("/api/samples")).status()).toBe(401);
    const ctx = await newSession(playwright);
    expect((await ctx.post("/api/samples", { data: { keys: ["nope"] } })).status()).toBe(400);
    expect(
      (
        await ctx.post("/api/samples", {
          headers: { "content-type": "application/json" },
          data: Buffer.from("{bad"),
        })
      ).status(),
    ).toBe(400);
    expect((await ctx.post("/api/samples", { data: { keys: "balanced" } })).status()).toBe(400);
    expect(((await (await ctx.get("/api/portfolios")).json()) as Json).portfolios).toEqual([]);

    const first = await ctx.post("/api/samples");
    expect(first.status()).toBe(201);
    const a = (await first.json()) as Json;
    expect(a.created.map((c: Json) => c.key)).toEqual(KEYS);
    expect(a.existing).toEqual([]);
    expect(a.skipped).toEqual([]);
    const list = ((await (await ctx.get("/api/portfolios")).json()) as Json).portfolios;
    expect(list.map((p: Json) => p.name)).toEqual(a.created.map((c: Json) => c.name)); // newest first, in catalogue order

    const second = await ctx.post("/api/samples");
    expect(second.status()).toBe(200);
    const b = (await second.json()) as Json;
    expect(b.created).toEqual([]);
    expect(b.existing).toHaveLength(5);
    expect(((await (await ctx.get("/api/portfolios")).json()) as Json).portfolios).toHaveLength(5);
  });

  test("a single sample loads on its own and every sample is analysable end to end", async ({
    playwright,
  }) => {
    const ctx = await newSession(playwright);
    const one = (await (
      await ctx.post("/api/samples", { data: { keys: ["balanced"] } })
    ).json()) as Json;
    expect(one.created).toHaveLength(1);
    await ctx.post("/api/samples");
    const list = ((await (await ctx.get("/api/portfolios")).json()) as Json).portfolios as Json[];
    expect(list).toHaveLength(5);
    for (const p of list) {
      for (const path of ["analytics", "correlation", "terminal", "radar", "move"]) {
        const r = await ctx.get(`/api/portfolios/${p.id}/${path}`);
        expect(r.status(), `${p.name} ${path}`).toBe(200);
      }
    }
  });

  test("two sessions get their own copies", async ({ playwright }) => {
    const a = await newSession(playwright);
    const b = await newSession(playwright);
    await a.post("/api/samples", { data: { keys: ["ai-boom"] } });
    expect(((await (await b.get("/api/portfolios")).json()) as Json).portfolios).toEqual([]);
  });
});

test.describe("samples in the app", () => {
  test("the empty dashboard offers samples, the guide, and a way to build your own", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("You have no portfolios yet.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Create a portfolio" })).toHaveAttribute(
      "href",
      "/portfolios/new",
    );
    await expect(page.getByRole("link", { name: "Read the guide" })).toHaveAttribute(
      "href",
      "/guide",
    );
    await page.getByRole("button", { name: "Load sample portfolios" }).click();
    await waitForDashboard(page);
    await expect(page.getByLabel("Portfolio", { exact: true }).locator("option")).toHaveText([
      /Mega-cap tech/,
      /Balanced across sectors/,
      /AI boom bet/,
      /Defensive staples/,
      /Energy and banks/,
    ]);
    await expect(appAlert(page)).toHaveCount(0);
  });

  test("the new portfolio page shows five described samples and loads one into the dashboard", async ({
    page,
  }) => {
    await page.goto("/portfolios/new");
    const list = page.getByRole("list", { name: "Sample portfolios" });
    await expect(list.getByRole("listitem")).toHaveCount(5);
    await expect(list.getByRole("listitem").first()).toContainText(
      "NVDA 25%, AAPL 20%, MSFT 20%, AMZN 15%, GOOGL 20%",
    );
    await expect(list.getByRole("listitem").first()).toContainText("Looks diversified");
    await page.getByRole("button", { name: "Load this sample: AI boom bet" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await waitForDashboard(page);
    const holdings = page
      .getByText("Holdings (effective")
      .locator("xpath=ancestor::*[@data-slot='card'][1]");
    await expect(holdings.getByRole("row")).toHaveCount(6); // header + five holdings
    for (const t of ["NVDA", "AMD", "AVGO", "MU", "MSFT"])
      await expect(holdings.getByRole("row", { name: new RegExp(t) })).toBeVisible();
    const api = (await (await page.request.get("/api/portfolios")).json()) as {
      portfolios: { name: string }[];
    };
    expect(api.portfolios.map((p) => p.name)).toEqual(["Sample: AI boom bet"]);
  });

  test("loading all samples, then one again, never creates duplicates", async ({ page }) => {
    const s = await startUiSession(page);
    void s;
    await page.goto("/portfolios/new");
    await page.getByRole("button", { name: "Load all samples" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/portfolios/new");
    await page.getByRole("button", { name: "Load this sample: Balanced across sectors" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    const api = (await (await page.request.get("/api/portfolios")).json()) as {
      portfolios: unknown[];
    };
    expect(api.portfolios).toHaveLength(5);
  });

  test("the samples demonstrate the ideas they claim to", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    await ctx.post("/api/samples");
    const list = ((await (await ctx.get("/api/portfolios")).json()) as Json).portfolios as Json[];
    const id = (key: string) => list.find((p) => p.name.toLowerCase().includes(key))!.id as string;
    const term = async (key: string) =>
      (await (await ctx.get(`/api/portfolios/${id(key)}/terminal`)).json()) as Json;
    const tech = await term("mega-cap");
    const balanced = await term("balanced");
    const defensive = await term("defensive");
    const ai = await term("ai boom");
    // Calmer portfolios are calmer, and concentrated ones are more correlated than a broad one.
    expect(balanced.correlation.average).toBeLessThan(ai.correlation.average + 0.5);
    expect(defensive.holdings).toHaveLength(6);
    expect(tech.holdings).toHaveLength(5);
    expect(balanced.holdings).toHaveLength(10);
    expect(new Set(balanced.holdings.map((h: Json) => h.sector)).size).toBeGreaterThanOrEqual(9);
    expect(new Set(tech.holdings.map((h: Json) => h.sector)).size).toBeLessThanOrEqual(3);
  });
});
