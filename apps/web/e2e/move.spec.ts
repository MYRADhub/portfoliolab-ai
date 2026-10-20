import { expect, test } from "@playwright/test";
import {
  EXAMPLE,
  NEWS_DATE,
  NEWS_TITLE,
  appAlert,
  createPortfolio,
  mock,
  moveCard,
  newSession,
  startUiSession,
  uniqueHoldings,
  waitForDashboard,
} from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const pp = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}`;

test.describe("move API", () => {
  test("splits the latest day into exact contributions that add up and agree with the analytics curve", async ({
    playwright,
  }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "Move", EXAMPLE);
    const m = (await (await ctx.get(`/api/portfolios/${id}/move`)).json()) as Json;
    expect(m.availableDates).toHaveLength(30);
    expect(m.availableDates[0]).toBe(m.date);
    expect([...m.availableDates].sort().reverse()).toEqual(m.availableDates);
    expect(m.holdings).toHaveLength(5);

    const sum = m.holdings.reduce((a: number, h: Json) => a + h.contribution, 0);
    expect(sum).toBeCloseTo(m.portfolioReturn, 12);
    for (const h of m.holdings) expect(h.contribution).toBeCloseTo(h.weight * h.assetReturn, 14);
    const order = m.holdings.map((h: Json) => Math.abs(h.contribution));
    expect(order).toEqual([...order].sort((a: number, b: number) => b - a));

    const a = (await (await ctx.get(`/api/portfolios/${id}/analytics`)).json()) as Json;
    const i = a.equityCurve.findIndex((p: Json) => p.date === m.date);
    expect(a.equityCurve[i].value / a.equityCurve[i - 1].value - 1).toBeCloseTo(
      m.portfolioReturn,
      10,
    );
    expect(m.previousDate).toBe(a.equityCurve[i - 1].date);

    const groupSum = m.groups.reduce((s: number, g: Json) => s + g.contribution, 0);
    expect(groupSum).toBeCloseTo(m.portfolioReturn, 12);
    if (m.groups[0].share !== null)
      expect(m.groups.reduce((s: number, g: Json) => s + g.share, 0)).toBeCloseTo(1, 10);
    expect(typeof m.headline).toBe("string");
  });

  test("a chosen date works for any listed day, and the first and non-trading days are rejected", async ({
    playwright,
  }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "Move", EXAMPLE);
    const latest = (await (await ctx.get(`/api/portfolios/${id}/move`)).json()) as Json;
    for (const d of [latest.availableDates[5], latest.availableDates[29]]) {
      const r = await ctx.get(`/api/portfolios/${id}/move?date=${d}`);
      expect(r.status()).toBe(200);
      expect(((await r.json()) as Json).date).toBe(d);
    }
    const a = (await (await ctx.get(`/api/portfolios/${id}/analytics?years=1`)).json()) as Json;
    const bad = [a.equityCurve[0].date, "2026-13-45", "1999-01-04", "2099-01-01", "2026-10-17"]; // first day, nonsense, too old, future, a Saturday
    for (const d of bad)
      expect((await ctx.get(`/api/portfolios/${id}/move?date=${d}`)).status(), d).toBe(400);
    for (const d of ["2026-1-1", "yesterday", "20261001", "2026-10-01T00:00"]) {
      expect(
        (await ctx.get(`/api/portfolios/${id}/move?date=${encodeURIComponent(d)}`)).status(),
        d,
      ).toBe(400);
    }
  });

  test("lists news linked to the holdings on the day it landed, merged and ranked, without weak links", async ({
    playwright,
  }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "News", EXAMPLE);
    const m = (await (
      await ctx.get(`/api/portfolios/${id}/move?date=${NEWS_DATE}`)
    ).json()) as Json;
    expect(m.news).toHaveLength(1); // two syndicated copies merged; the weak "Target" link excluded
    expect(m.news[0]).toMatchObject({
      title: NEWS_TITLE,
      tickers: ["NVDA"],
      copies: 1,
      linkScore: 0.9,
      source: "E2E Wire",
    });
    expect(m.news[0].classification).toMatchObject({
      class: "fundamental",
      eventType: "guidance_cut",
      fundamentalImportance: 8,
      marketRelevance: 7,
      expectedPersistence: 8,
    });
    expect(JSON.stringify(m.news)).not.toContain("Target noise");
    // A portfolio that does not hold NVDA sees none of it.
    const other = await createPortfolio(ctx, "NoNvda", [
      { ticker: "AAPL", weightPct: 50 },
      { ticker: "MSFT", weightPct: 50 },
    ]);
    expect(
      ((await (await ctx.get(`/api/portfolios/${other}/move?date=${NEWS_DATE}`)).json()) as Json)
        .news,
    ).toEqual([]);
    // And another day has none.
    const latest = (await (await ctx.get(`/api/portfolios/${id}/move`)).json()) as Json;
    expect(latest.news).toEqual([]);
  });

  test("requires a session and hides other sessions' portfolios", async ({
    playwright,
    request,
  }) => {
    expect(
      (await request.get("/api/portfolios/00000000-0000-4000-8000-000000000000/move")).status(),
    ).toBe(401);
    expect(
      (
        await request.post("/api/portfolios/00000000-0000-4000-8000-000000000000/move/explain")
      ).status(),
    ).toBe(401);
    const owner = await newSession(playwright);
    const intruder = await newSession(playwright);
    const id = await createPortfolio(owner, "Mine", EXAMPLE);
    expect((await intruder.get(`/api/portfolios/${id}/move`)).status()).toBe(404);
    expect((await intruder.post(`/api/portfolios/${id}/move/explain`)).status()).toBe(404);
    expect((await owner.get("/api/portfolios/not-a-uuid/move")).status()).toBe(400);
  });

  test("reports portfolios that cannot be analysed", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "Thin", [
      { ticker: "NVDA", weightPct: 50 },
      { ticker: "TGT", weightPct: 50 },
    ]);
    expect((await ctx.get(`/api/portfolios/${id}/move`)).status()).toBe(409);
  });
});

test.describe("move explanation (mock OpenAI)", () => {
  test.beforeEach(async () => {
    await mock.reset();
  });

  test("is grounded in the move figures and the linked news, told not to claim causation, and cached per day", async ({
    playwright,
  }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "Explained", uniqueHoldings());
    // uniqueHoldings only holds NVDA and AAPL, and NVDA has the seeded news on NEWS_DATE.
    const r = await ctx.post(`/api/portfolios/${id}/move/explain?date=${NEWS_DATE}`);
    expect(r.status()).toBe(200);
    const body = (await r.json()) as Json;
    expect(body.explanation).toMatchObject({ source: "model", issues: [] });
    expect(body.move.date).toBe(NEWS_DATE);
    const fact = (label: string) =>
      body.facts.filter((f: Json) => f.label === label).map((f: Json) => f.text);
    expect(fact("Portfolio return that day")).toEqual([`${pp(body.move.portfolioReturn)}%`]);
    expect(fact("Linked news")[0]).toBe(`${NEWS_TITLE} (fundamental, NVDA)`);
    expect(fact("Holding contribution")).toHaveLength(2);
    expect(fact("Caution")[0]).toMatch(/may coincide with, not cause/);

    const reqs = await mock.requests();
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.input).toContain(`Explain why the portfolio moved on ${NEWS_DATE}`);
    expect(reqs[0]!.input).toMatch(/never claim it caused the move/);
    expect(reqs[0]!.input).toContain("<facts>");

    expect(
      (
        (await (
          await ctx.post(`/api/portfolios/${id}/move/explain?date=${NEWS_DATE}`)
        ).json()) as Json
      ).cached,
    ).toBe(true);
    expect(await mock.requests()).toHaveLength(1);
    // A different day is a different question.
    const other = (await (await ctx.post(`/api/portfolios/${id}/move/explain`)).json()) as Json;
    expect(other.cached).toBe(false);
    expect(await mock.requests()).toHaveLength(2);
  });

  test("falls back to the figures when the model's text is ungrounded", async ({ playwright }) => {
    await mock.setMode("ungrounded");
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "Fallback", uniqueHoldings());
    const body = (await (await ctx.post(`/api/portfolios/${id}/move/explain`)).json()) as Json;
    expect(body.explanation.source).toBe("fallback");
    expect(JSON.stringify(body.explanation)).not.toContain("99.99%");
  });

  test("shares the hourly allowance with the portfolio explanation", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    for (let i = 0; i < 5; i++) {
      const id = await createPortfolio(ctx, `P${i}`, uniqueHoldings());
      expect((await ctx.post(`/api/portfolios/${id}/explain`)).status()).toBe(200);
    }
    for (let i = 0; i < 5; i++) {
      const id = await createPortfolio(ctx, `M${i}`, uniqueHoldings());
      expect((await ctx.post(`/api/portfolios/${id}/move/explain`)).status()).toBe(200);
    }
    const id = await createPortfolio(ctx, "Over", uniqueHoldings());
    expect((await ctx.post(`/api/portfolios/${id}/move/explain`)).status()).toBe(429);
    expect((await ctx.post(`/api/portfolios/${id}/explain`)).status()).toBe(429);
  });

  test("rejects a bad date before calling the model", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "Bad", uniqueHoldings());
    expect((await ctx.post(`/api/portfolios/${id}/move/explain?date=2099-01-01`)).status()).toBe(
      400,
    );
    expect(await mock.requests()).toHaveLength(0);
  });
});

test.describe("move panel", () => {
  test.beforeEach(async () => {
    await mock.reset();
  });

  test("shows the latest day's return, headline, contributions and sector split, matching the API", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Panel", EXAMPLE);
    await page.reload();
    await waitForDashboard(page);
    const api = (await (await page.request.get(`/api/portfolios/${id}/move`)).json()) as Json;
    const card = moveCard(page);
    await expect(card.getByRole("heading", { name: "News linked to your holdings" })).toBeVisible();
    await expect(card.getByRole("combobox", { name: "Day" })).toHaveValue(api.date);
    await expect(card.getByLabel("Portfolio return that day")).toHaveText(
      `${pp(api.portfolioReturn)}%`,
    );
    await expect(card.getByText(api.headline)).toBeVisible();

    const holdings = card.getByRole("table", { name: "Contribution by holding" });
    await expect(holdings.locator("tbody tr")).toHaveCount(5);
    const first = api.holdings[0];
    await expect(holdings.locator("tbody tr").first()).toContainText(first.ticker);
    await expect(holdings.locator("tbody tr").first()).toContainText(pp(first.contribution));
    const sectors = card.getByRole("table", { name: "Contribution by sector" });
    await expect(sectors.locator("tbody tr")).toHaveCount(api.groups.length);
    await expect(card.locator(".recharts-surface")).toHaveCount(1);
    await expect(card.getByText("No linked news found for this day.")).toBeVisible();
    await expect(card.getByText(/may coincide with, not cause, a price move/)).toBeVisible();
  });

  test("changing the day updates every figure and shows that day's news", async ({ page }) => {
    const s = await startUiSession(page);
    const id = await s.create("Days", EXAMPLE);
    await page.reload();
    await waitForDashboard(page);
    const card = moveCard(page);
    await expect(card.getByRole("combobox", { name: "Day" })).not.toHaveValue(NEWS_DATE);

    await card.getByRole("combobox", { name: "Day" }).selectOption(NEWS_DATE);
    const api = (await (
      await page.request.get(`/api/portfolios/${id}/move?date=${NEWS_DATE}`)
    ).json()) as Json;
    await expect(card.getByLabel("Portfolio return that day")).toHaveText(
      `${pp(api.portfolioReturn)}%`,
    );
    const link = card.getByRole("link", { name: NEWS_TITLE });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(
      card.getByText(/NVDA \| E2E Wire \| fundamental \(importance 8 of 10\) \| 1 similar/),
    ).toBeVisible();
    await expect(card.getByText("Target noise")).toHaveCount(0);
    await expect(card.getByText("No linked news found for this day.")).toHaveCount(0);
  });

  test("explains the move with citations, can be refreshed, and is cleared when the day changes", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Explain move", uniqueHoldings());
    await page.reload();
    await waitForDashboard(page);
    const card = moveCard(page);
    await card.getByRole("combobox", { name: "Day" }).selectOption(NEWS_DATE);
    await card.getByRole("button", { name: "Explain this move" }).click();
    await expect(card.getByRole("button", { name: "Refresh explanation" })).toBeVisible();
    await expect(card.locator("sup").first()).toHaveText("F1");
    await expect(card).toContainText("Day analysed:");
    await expect(card.getByText(/not investment advice/)).toBeVisible();
    await card.getByText("Figures used").click();
    await expect(card.getByText(new RegExp(`Linked news: ${NEWS_TITLE}`))).toBeVisible();

    await card.getByRole("combobox", { name: "Day" }).selectOption({ index: 1 });
    await expect(card.getByRole("button", { name: "Explain this move" })).toBeVisible();
    await expect(card.getByText("Figures used")).toHaveCount(0);
  });

  test("shows the figures with a notice when the text cannot be verified, and an error when the service fails", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Failing", uniqueHoldings());
    await page.reload();
    await waitForDashboard(page);
    const card = moveCard(page);

    await mock.setMode("ungrounded");
    await card.getByRole("button", { name: "Explain this move" }).click();
    await expect(card.getByText(/could not be verified against the numbers/)).toBeVisible();
    await expect(card.getByText("99.99")).toHaveCount(0);

    await mock.setMode("error");
    await card.getByRole("combobox", { name: "Day" }).selectOption({ index: 2 });
    await card.getByRole("button", { name: "Explain this move" }).click();
    await expect(appAlert(page)).toHaveText("Something went wrong");
  });

  test("a portfolio that cannot be analysed shows no move panel, only the analytics error", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Thin", [
      { ticker: "NVDA", weightPct: 50 },
      { ticker: "TGT", weightPct: 50 },
    ]);
    await page.reload();
    await expect(appAlert(page)).toContainText("shared history");
    await expect(page.getByText("Why did my portfolio move?")).toHaveCount(0);
  });
});
