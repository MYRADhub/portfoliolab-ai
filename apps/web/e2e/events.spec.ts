import { expect, test } from "@playwright/test";
import { NEWS_TITLE } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test.describe("event study API", () => {
  test("studies classified stories, skips unclassified ones, and keeps the numbers consistent", async ({
    page,
  }) => {
    const r = await page.request.get("/api/events");
    expect(r.status()).toBe(200);
    const b = (await r.json()) as Json;

    // Seeded: story, radar r1, r2, r3 (classified), AMZN and JPM (unclassified); the weak Target link is excluded.
    expect(b.eventsFound).toBe(6);
    expect(b.skipped.not_classified).toBe(2);
    expect(b.eventsStudied).toBeGreaterThanOrEqual(1);
    expect(
      b.eventsStudied + Object.values(b.skipped).reduce((a: number, n) => a + (n as number), 0),
    ).toBe(b.eventsFound);
    expect(b.universe).toBeGreaterThanOrEqual(20);

    const story = b.reactions.find((x: Json) => x.title === NEWS_TITLE);
    expect(story).toBeDefined();
    expect(story).toMatchObject({
      ticker: "NVDA",
      eventType: "guidance_cut",
      class: "fundamental",
    });
    expect(Number.isFinite(story.beta)).toBe(true);
    // The event-day cumulative abnormal return is the event-day abnormal return, and horizons ascend.
    expect(story.car[0]).toMatchObject({ horizon: 0 });
    expect(story.car[0].value).toBeCloseTo(story.ar0, 12);
    expect(story.car.map((c: Json) => c.horizon)).toEqual([0, 1, 5]); // six weekdays of data after the event: day 10 has not happened yet
    // Each t-statistic is the CAR over sigma * sqrt(days), so z0 and car[0].t agree.
    expect(story.car[0].t).toBeCloseTo(story.z0, 8);

    const z = b.reactions.map((x: Json) => Math.abs(x.z0 ?? 0));
    expect([...z].sort((a, c) => c - a)).toEqual(z);
  });

  test("averages per event type and refuses to call a handful of events evidence", async ({
    page,
  }) => {
    const b = (await (await page.request.get("/api/events")).json()) as Json;
    expect(b.byType).toHaveLength(1);
    const t = b.byType[0];
    expect(t).toMatchObject({ slug: "guidance_cut", name: "Guidance cut", n: b.eventsStudied });
    const h0 = t.horizons.find((h: Json) => h.horizon === 0);
    expect(h0.stats.n).toBe(t.n);
    expect(h0.stats.ci[0]).toBeLessThanOrEqual(h0.stats.mean);
    expect(h0.stats.ci[1]).toBeGreaterThanOrEqual(h0.stats.mean);
    expect(h0.stats.sufficient).toBe(t.n >= 5);
    // Typical move is the mean absolute event-day abnormal return of the studied events.
    const studied = (b.reactions as Json[]).filter((r) => r.eventType === "guidance_cut");
    if (studied.length === b.byType[0].n) {
      const mean = studied.reduce((acc, r) => acc + Math.abs(r.ar0), 0) / studied.length;
      expect(t.typicalMove).toBeCloseTo(mean, 12);
    }
    expect(t.unusualShare).toBeGreaterThanOrEqual(0);
    expect(t.unusualShare).toBeLessThanOrEqual(1);
    // Reproducible: the bootstrap is seeded.
    const again = (await (await page.request.get("/api/events")).json()) as Json;
    expect(again.byType).toEqual(b.byType);
  });
});

test.describe("reactions page", () => {
  test("shows the summary, the per-type table and the biggest reactions", async ({ page }) => {
    await page.goto("/events");
    await expect(page.getByRole("heading", { name: "Reactions", level: 1 })).toBeVisible();
    await expect(page.getByTestId("events-summary")).toContainText("story-stock pairs studied");
    await expect(page.getByTestId("events-summary")).toContainText("not yet classified");

    const table = page.getByRole("table", { name: "Average reaction by event type" });
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(table).toContainText("Guidance cut");
    await expect(table).toContainText("Too few events to judge");

    const list = page.getByRole("list", { name: "Reactions" });
    await expect(list.getByRole("link", { name: NEWS_TITLE })).toBeVisible();
    await expect(page.getByText(/not a prediction or advice/)).toBeVisible();
  });

  test("the API figure for the story is the one on the page", async ({ page }) => {
    const b = (await (await page.request.get("/api/events")).json()) as Json;
    const story = b.reactions.find((x: Json) => x.title === NEWS_TITLE);
    await page.goto("/events");
    const row = page
      .getByRole("list", { name: "Reactions" })
      .getByRole("listitem")
      .filter({ hasText: NEWS_TITLE });
    const pct = `${story.ar0 >= 0 ? "+" : ""}${(story.ar0 * 100).toFixed(2)}%`;
    await expect(row).toContainText(pct);
  });
});

test.describe("spillover test", () => {
  test("lists only companies with enough earnings history", async ({ page }) => {
    const r = (await (await page.request.get("/api/events/spillover")).json()) as Json;
    expect(Array.isArray(r.eligible)).toBe(true);
    // the fixtures give NVDA two earnings-type events, fewer than the four needed to be offered
    expect(r.eligible).not.toContain("NVDA");
  });

  test("runs for any profiled company but withholds figures when too few stocks can be compared", async ({
    page,
  }) => {
    const b = (await (
      await page.request.get("/api/events/spillover?ticker=nvda&events=12")
    ).json()) as Json;
    expect(b).toMatchObject({ ticker: "NVDA", minStocks: 30, summary: null, partialSummary: null });
    expect(b.events.length).toBeGreaterThanOrEqual(1);
    for (const e of b.events) {
      expect(e.ar0).not.toBe(0);
      expect(e.stocks).toBeLessThanOrEqual(9); // only nine other profiled stocks exist in the fixtures
      expect(e.correlation).toBeNull();
      expect(e.partialCorrelation).toBeNull();
    }
  });

  test("the pooled test withholds figures when no day has enough comparable stocks", async ({
    page,
  }) => {
    const r = (await (await page.request.get("/api/events/spillover?pooled=1")).json()) as Json;
    expect(r).toMatchObject({
      events: 0,
      clusters: 0,
      correlation: null,
      clusteredCorrelation: null,
      minStocks: 30,
    });
    expect(r.placebo).toMatchObject({ permutations: 0, pCorrelation: null });
  });

  test("the pooled request is validated", async ({ page }) => {
    expect((await page.request.get("/api/events/spillover?pooled=2")).status()).toBe(400);
  });

  test("validates the request", async ({ page }) => {
    const get = (q: string) => page.request.get(`/api/events/spillover?${q}`);
    expect((await get("ticker=ZZZZ")).status()).toBe(404);
    expect((await get("ticker=XOM")).status()).toBe(400); // no exposure profile
    expect((await get("ticker=bad%20ticker!")).status()).toBe(400);
    expect((await get("ticker=NVDA&events=0")).status()).toBe(400);
    expect((await get("ticker=NVDA&events=99")).status()).toBe(400);
  });

  test("the Reactions page explains the test and says when nothing can be run yet", async ({
    page,
  }) => {
    await page.goto("/events");
    await expect(
      page.getByText("Do stocks with similar hidden exposures move together?"),
    ).toBeVisible();
    await expect(
      page.getByText("No large company has enough earnings history to run this test yet."),
    ).toBeVisible();
    await expect(page.getByText("All large companies pooled")).toBeVisible();
    await expect(page.getByTestId("pooled-verdict")).toContainText("Not enough earnings days");
    const note = page.locator("details").filter({ hasText: "How this test works" });
    await expect(note).toBeVisible();
    await expect(note).not.toHaveAttribute("open", "");
  });
});
