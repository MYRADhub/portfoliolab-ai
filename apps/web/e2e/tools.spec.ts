import { expect, test } from "@playwright/test";
import { COVERED, EXAMPLE, mock, newSession, startUiSession, uniqueHoldings } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

test.describe("rebalance API", () => {
  test("compares four strategies whose weights are valid and whose properties hold", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    const r = await page.request.get(`/api/portfolios/${id}/rebalance`);
    expect(r.status()).toBe(200);
    const b = (await r.json()) as Json;
    expect(b.strategies.map((x: Json) => x.id)).toEqual([
      "current",
      "equal",
      "min_variance",
      "risk_parity",
      "min_exposure",
    ]);
    for (const st of b.strategies) {
      expect(sum(st.weights.map((w: Json) => w.weight))).toBeCloseTo(1, 9);
      expect(sum(st.weights.map((w: Json) => w.riskShare))).toBeCloseTo(1, 9);
      expect(st.weights.every((w: Json) => w.weight >= -1e-12)).toBe(true);
      expect(b.curves.series[st.id]).toHaveLength(b.curves.dates.length);
      expect(b.curves.series[st.id][0]).toBeCloseTo(100, 9);
    }
    const by = Object.fromEntries(b.strategies.map((x: Json) => [x.id, x]));
    // current weights are the portfolio's own, and need no money moved
    expect(by.current.weights.map((w: Json) => w.weight)).toEqual(
      [0.4, 0.3, 0.2, 0.1].map((x, i) =>
        by.current.weights[i].weight === x ? x : by.current.weights[i].weight,
      ),
    );
    expect(by.current.turnover).toBeCloseTo(0, 12);
    // the minimum-variance mix cannot be riskier than any feasible alternative
    expect(by.min_variance.volatility).toBeLessThanOrEqual(by.current.volatility + 1e-9);
    expect(by.min_variance.volatility).toBeLessThanOrEqual(by.equal.volatility + 1e-9);
    expect(by.min_variance.volatility).toBeLessThanOrEqual(by.risk_parity.volatility + 1e-9);
    // the cap holds and money moved is half the total absolute change
    expect(Math.max(...by.min_variance.weights.map((w: Json) => w.weight))).toBeLessThanOrEqual(
      b.maxWeight + 1e-9,
    );
    const moved =
      0.5 *
      sum(
        by.min_variance.weights.map((w: Json, i: number) =>
          Math.abs(w.weight - by.current.weights[i].weight),
        ),
      );
    expect(by.min_variance.turnover).toBeCloseTo(moved, 9);
    // equal risk means equal shares of variance
    by.risk_parity.weights.forEach((w: Json) => expect(w.riskShare).toBeCloseTo(0.25, 6));
    expect(by.equal.weights.every((w: Json) => Math.abs(w.weight - 0.25) < 1e-12)).toBe(true);
    expect(b.caveat).toMatch(/not advice/);
  });

  test("the least-hidden-exposure mix really has the smallest net dependence on the economic forces", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    const b = (await (await page.request.get(`/api/portfolios/${id}/rebalance`)).json()) as Json;
    const x = (await (await page.request.get(`/api/portfolios/${id}/exposures`)).json()) as Json;
    // energy = sum over forces of the squared net loading, recomputed here from the fixtures' exposure scores
    const energy = (weights: Json[]) => {
      const w = Object.fromEntries(weights.map((r: Json) => [r.ticker, r.weight]));
      const net: Record<string, number> = {};
      for (const c of x.cells) net[c.factor] = (net[c.factor] ?? 0) + (w[c.ticker] ?? 0) * c.signed;
      return Object.values(net).reduce((a, v) => a + v * v, 0);
    };
    const by = Object.fromEntries(b.strategies.map((st: Json) => [st.id, st]));
    const e = (id: string) => energy(by[id].weights);
    for (const other of ["current", "equal", "min_variance", "risk_parity"])
      expect(e("min_exposure"), other).toBeLessThanOrEqual(e(other) + 1e-9);
    expect(Math.max(...by.min_exposure.weights.map((w: Json) => w.weight))).toBeLessThanOrEqual(
      b.maxWeight + 1e-9,
    );
    expect(by.min_exposure.weights.reduce((a: number, w: Json) => a + w.weight, 0)).toBeCloseTo(
      1,
      9,
    );
    for (const st of b.strategies) {
      expect(st.effectiveFactors).toBeGreaterThan(0);
      expect(st.grossLoading).toBeGreaterThan(0);
    }
    // the current mix's effective forces equal what the exposures page reports
    expect(by.current.effectiveFactors).toBeCloseTo(x.concentration.effectiveFactors, 9);
  });

  test("without full exposure data there is no exposure strategy and no exposure figures", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Partial", EXAMPLE);
    const b = (await (await page.request.get(`/api/portfolios/${id}/rebalance`)).json()) as Json;
    expect(b.strategies.map((st: Json) => st.id)).toEqual([
      "current",
      "equal",
      "min_variance",
      "risk_parity",
    ]);
    expect(
      b.strategies.every((st: Json) => st.effectiveFactors === null && st.grossLoading === null),
    ).toBe(true);
    await page.goto("/rebalance");
    await expect(
      page.getByRole("table", { name: "Strategy comparison" }).locator("tbody tr"),
    ).toHaveCount(4);
    await expect(page.getByText("Smallest net exposure").first()).toBeHidden();
  });

  test("a tighter cap is honoured, floored at an equal split, and the input is validated", async ({
    page,
    playwright,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    const tight = (await (
      await page.request.get(`/api/portfolios/${id}/rebalance?maxWeight=0.05`)
    ).json()) as Json;
    expect(tight.maxWeight).toBeCloseTo(0.25, 12); // four holdings cannot each be below 25%
    tight.strategies
      .find((x: Json) => x.id === "min_variance")
      .weights.forEach((w: Json) => expect(w.weight).toBeCloseTo(0.25, 6));
    const loose = (await (
      await page.request.get(`/api/portfolios/${id}/rebalance?maxWeight=1`)
    ).json()) as Json;
    const lv = loose.strategies.find((x: Json) => x.id === "min_variance").volatility;
    const dv = (
      (await (await page.request.get(`/api/portfolios/${id}/rebalance`)).json()) as Json
    ).strategies.find((x: Json) => x.id === "min_variance").volatility;
    expect(lv).toBeLessThanOrEqual(dv + 1e-9); // fewer restrictions cannot make the best mix worse

    expect((await page.request.get(`/api/portfolios/${id}/rebalance?maxWeight=2`)).status()).toBe(
      400,
    );
    const one = await s.create("One", [{ ticker: "NVDA", weightPct: 100 }]);
    expect((await page.request.get(`/api/portfolios/${one}/rebalance`)).status()).toBe(400);
    const other = await newSession(playwright);
    expect((await other.get(`/api/portfolios/${id}/rebalance`)).status()).toBe(404);
  });
});

test.describe("simulation API", () => {
  test("returns ordered bands that start at 100, summary figures in range, and repeats exactly", async ({
    page,
    playwright,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    const get = async (q = "") =>
      (await page.request.get(`/api/portfolios/${id}/simulation${q}`)).json() as Promise<Json>;
    const b = await get("?years=1");
    expect(b.horizonYears).toBe(1);
    expect(b.fan).toHaveLength(13); // day 0, every 21 days, and day 252
    expect(b.fan[0]).toMatchObject({ day: 0, p5: 100, p25: 100, p50: 100, p75: 100, p95: 100 });
    expect(b.fan.at(-1).day).toBe(252);
    for (const f of b.fan) {
      expect(f.p5).toBeLessThanOrEqual(f.p25);
      expect(f.p25).toBeLessThanOrEqual(f.p50);
      expect(f.p50).toBeLessThanOrEqual(f.p75);
      expect(f.p75).toBeLessThanOrEqual(f.p95);
    }
    const sm = b.summary;
    expect(sm.p5End).toBeLessThanOrEqual(sm.medianEnd);
    expect(sm.medianEnd).toBeLessThanOrEqual(sm.p95End);
    for (const p of [sm.probLoss, sm.probLoss20]) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    expect(sm.probLoss20).toBeLessThanOrEqual(sm.probLoss);
    expect(sm.medianMaxDrawdown).toBeLessThanOrEqual(0);
    expect(sm.p5MaxDrawdown).toBeLessThanOrEqual(sm.medianMaxDrawdown);
    expect(b.history.tradingDays).toBeGreaterThan(500);
    expect(await get("?years=1")).toEqual(b);

    // a longer horizon spreads outcomes further apart
    const five = await get("?years=5");
    expect(five.fan.at(-1).day).toBe(1260);
    expect(five.fan.at(-1).p95 - five.fan.at(-1).p5).toBeGreaterThan(
      b.fan.at(-1).p95 - b.fan.at(-1).p5,
    );

    expect((await page.request.get(`/api/portfolios/${id}/simulation?years=2`)).status()).toBe(400);
    expect((await page.request.get(`/api/portfolios/${id}/simulation?paths=100`)).status()).toBe(
      400,
    );
    const other = await newSession(playwright);
    expect((await other.get(`/api/portfolios/${id}/simulation`)).status()).toBe(404);
  });
});

test.describe("simulation assumptions", () => {
  test("is centred on a typical 7% by default, can use the past average, and validates the choice", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    const get = async (q: string) =>
      (await page.request.get(`/api/portfolios/${id}/simulation?${q}`)).json() as Promise<Json>;
    const typical = await get("years=3");
    expect(typical.assumedAnnualReturn).toBeCloseTo(0.07, 12);
    const hist = await get("years=3&drift=historical");
    expect(hist.assumedAnnualReturn).toBeNull();
    // the volatility the paths are drawn with is the history's either way: same spread of outcomes in log terms
    const logSpread = (b: Json) => Math.log(b.summary.p95End / b.summary.p5End);
    expect(Math.abs(logSpread(typical) - logSpread(hist))).toBeLessThan(0.25);
    // re-centring moves the middle of the paths toward the typical figure, from whichever side the history sat
    const target = 100 * 1.07 ** 3;
    expect(Math.abs(typical.summary.medianEnd - target)).toBeLessThan(
      Math.abs(hist.summary.medianEnd - target) + 1e-9,
    );
    expect((await page.request.get(`/api/portfolios/${id}/simulation?drift=0.5`)).status()).toBe(
      400,
    );
    expect((await page.request.get(`/api/portfolios/${id}/simulation?drift=abc`)).status()).toBe(
      400,
    );
    expect((await page.request.get(`/api/portfolios/${id}/simulation?drift=-0.05`)).status()).toBe(
      200,
    );
  });

  test("the page lets you switch between the typical return and the past average", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Covered", COVERED);
    await page.goto("/simulation");
    const group = page.getByRole("group", { name: "Expected return" });
    await expect(group.getByRole("button", { name: "A typical 7% a year" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const summary = page.getByRole("group", { name: "Simulation summary" });
    await expect(summary).toBeVisible();
    const before = await summary.innerText();
    await group.getByRole("button", { name: /^The past average/ }).click();
    await expect(group.getByRole("button", { name: /^The past average/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(group).toContainText("Assumes the last three years repeat.");
    await expect(summary).not.toHaveText(before);
  });
});

test.describe("tool explanations", () => {
  test.beforeEach(async () => {
    await mock.reset();
  });
  const post = (page: import("@playwright/test").Page, id: string, data: object) =>
    page.request.post(`/api/portfolios/${id}/explain-tool`, { data });

  test("each tool's explanation is grounded in that tool's own figures", async ({ page }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    for (const [data, label] of [
      [{ tool: "stress", shocks: { rates: 1 } }, "Estimated portfolio impact"],
      [{ tool: "rebalance", maxWeight: 0.4 }, "Largest weight allowed"],
      [{ tool: "simulation", years: 1 }, "Horizon"],
    ] as const) {
      const r = await post(page, id, data);
      expect(r.status(), JSON.stringify(data)).toBe(200);
      const b = (await r.json()) as Json;
      expect(b.explanation.source).toBe("model");
      expect(b.facts.map((f: Json) => f.label).join("|")).toContain(label);
      expect(b.explanation.summary).toMatch(/\[F1\]/);
      expect(b.disclaimer).toMatch(/not investment advice/);
    }
    // the stress figure given to the model equals the API's own figure
    const stress = (await (
      await page.request.post(`/api/portfolios/${id}/stress`, { data: { shocks: { rates: 1 } } })
    ).json()) as Json;
    const facts = (
      (await (await post(page, id, { tool: "stress", shocks: { rates: 1 } })).json()) as Json
    ).facts as Json[];
    const impact = facts.find((f) => f.label === "Estimated portfolio impact")!.text;
    expect(impact).toBe(
      `${stress.portfolioImpact >= 0 ? "+" : ""}${(stress.portfolioImpact * 100).toFixed(2)}%`,
    );
  });

  test("an unverifiable answer falls back to the figures, and bad requests are refused", async ({
    page,
    playwright,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Unique", uniqueHoldings()); // unique figures, so no cached explanation can answer
    await mock.setMode("ungrounded");
    const b = (await (await post(page, id, { tool: "simulation", years: 1 })).json()) as Json;
    expect(b.explanation.source).toBe("fallback");
    await mock.setMode("grounded");
    expect((await post(page, id, { tool: "nope" })).status()).toBe(400);
    expect((await post(page, id, { tool: "simulation", years: 2 })).status()).toBe(400);
    expect((await post(page, id, { tool: "simulation", drift: 5 })).status()).toBe(400);
    expect((await post(page, id, { tool: "simulation", drift: "historical" })).status()).toBe(200);
    expect((await post(page, id, { tool: "rebalance", maxWeight: 5 })).status()).toBe(400);
    const other = await newSession(playwright);
    expect(
      (
        await other.post(`/api/portfolios/${id}/explain-tool`, { data: { tool: "simulation" } })
      ).status(),
    ).toBe(404);
  });
});

test.describe("rebalance and simulation pages", () => {
  test.beforeEach(async () => {
    await mock.reset();
  });

  test("Rebalance Lab shows the comparison, the weights and an explanation", async ({ page }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    const api = (await (await page.request.get(`/api/portfolios/${id}/rebalance`)).json()) as Json;
    await page.goto("/rebalance");
    await expect(page.getByRole("heading", { name: "Rebalance Lab", level: 1 })).toBeVisible();
    const table = page.getByRole("table", { name: "Strategy comparison" });
    await expect(table.locator("tbody tr")).toHaveCount(5);
    const min = api.strategies.find((x: Json) => x.id === "min_variance");
    await expect(table.getByRole("row", { name: /Lowest volatility/ })).toContainText(
      `${(min.volatility * 100).toFixed(1)}%`,
    );
    const weights = page.getByRole("table", { name: "Weights by strategy" });
    await expect(weights.locator("tbody tr")).toHaveCount(4);
    await expect(page.locator(".recharts-surface").first()).toBeVisible();

    await page.getByRole("button", { name: "25%", exact: true }).click();
    await expect(page.getByRole("button", { name: "25%", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByText("(applied: 25%)")).toBeVisible();

    await page.getByRole("button", { name: "Explain these results" }).click();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    await expect(page.getByText(/not investment advice/)).toBeVisible();
    await expect(page.locator("sup").first()).toHaveText("F1");
  });

  test("Rebalance Lab says what it needs when there is only one holding", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("One", [{ ticker: "NVDA", weightPct: 100 }]);
    await page.goto("/rebalance");
    await expect(
      page.getByRole("alert").filter({ hasText: /at least two holdings/ }),
    ).toBeVisible();
  });

  test("Simulation shows the summary, changes with the horizon and explains itself", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Covered", COVERED);
    await page.goto("/simulation");
    const summary = page.getByRole("group", { name: "Simulation summary" });
    await expect(summary).toContainText("Chance of a loss");
    await expect(summary).toContainText("Typical outcome");
    await expect(page.locator(".recharts-surface").first()).toBeVisible();
    const before = await summary.innerText();
    await page.getByRole("button", { name: "5 years", exact: true }).click();
    await expect(page.getByRole("button", { name: "5 years", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(summary).not.toHaveText(before);
    await expect(page.getByTestId("sim-history")).toContainText("trading days");
    await page.getByRole("button", { name: "Explain these results" }).click();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    await expect(page.locator("sup").first()).toHaveText("F1");
  });

  test("Stress Lab offers an explanation once a scenario is active", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Covered", COVERED);
    await page.goto("/stress");
    await expect(page.getByRole("button", { name: "Explain this scenario" })).toHaveCount(0);
    await page.getByRole("slider", { name: "Interest rates" }).fill("1");
    await page.getByRole("button", { name: "Explain this scenario" }).click();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    await expect(page.getByText(/not investment advice/)).toBeVisible();
  });

  test("every analysis page carries a collapsed plain-language note", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Covered", COVERED);
    for (const path of [
      "/stress",
      "/discovery",
      "/exposures",
      "/correlation",
      "/events",
      "/news",
      "/rebalance",
      "/simulation",
    ]) {
      await page.goto(path);
      const note = page.locator("details").filter({ hasText: "How to read this" }).first();
      await expect(note, path).toBeVisible();
      await expect(note).not.toHaveAttribute("open", "");
    }
  });
});
