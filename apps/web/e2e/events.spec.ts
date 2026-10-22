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
