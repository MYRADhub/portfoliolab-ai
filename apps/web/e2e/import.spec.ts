import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { startUiSession } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test.describe("import API", () => {
  const preview = (
    request: import("@playwright/test").APIRequestContext,
    kind: string,
    holdings: object[],
  ) => request.post("/api/import/preview", { data: { kind, holdings } });

  test("percentages are rescaled to 100 and values are divided by their total", async ({
    request,
  }) => {
    const w = (await (
      await preview(request, "weights", [
        { ticker: "AAPL", amount: 30 },
        { ticker: "MSFT", amount: 20 },
      ])
    ).json()) as Json;
    expect(w.holdings.map((h: Json) => [h.ticker, h.weightPct])).toEqual([
      ["AAPL", 60],
      ["MSFT", 40],
    ]);
    const v = (await (
      await preview(request, "values", [
        { ticker: "AAPL", amount: 3000 },
        { ticker: "MSFT", amount: 1000 },
      ])
    ).json()) as Json;
    expect(v.holdings.map((h: Json) => h.weightPct)).toEqual([75, 25]);
    expect(v.holdings.every((h: Json) => h.price === null)).toBe(true);
  });

  test("share counts are priced at the latest close", async ({ request }) => {
    const price = async (t: string) =>
      ((await (await request.get(`/api/research/${t}`)).json()) as Json).stats.last as number;
    const [pa, pm] = [await price("AAPL"), await price("MSFT")];
    const b = (await (
      await preview(request, "shares", [
        { ticker: "AAPL", amount: 10 },
        { ticker: "MSFT", amount: 5 },
      ])
    ).json()) as Json;
    const total = 10 * pa + 5 * pm;
    const byTicker = Object.fromEntries(b.holdings.map((h: Json) => [h.ticker, h]));
    expect(byTicker.AAPL.weightPct).toBeCloseTo((10 * pa * 100) / total, 3);
    expect(byTicker.MSFT.weightPct).toBeCloseTo((5 * pm * 100) / total, 3);
    expect(byTicker.AAPL.price).toBeCloseTo(pa, 9);
    expect(b.holdings.reduce((a: number, h: Json) => a + h.weightPct, 0)).toBeCloseTo(100, 2);
  });

  test("unknown tickers, unpriced shares and thin history are reported rather than hidden", async ({
    request,
  }) => {
    const b = (await (
      await preview(request, "weights", [
        { ticker: "AAPL", amount: 50 },
        { ticker: "ZZZZ", amount: 30 },
        { ticker: "TGT", amount: 20 },
      ])
    ).json()) as Json;
    expect(b.unknown).toEqual(["ZZZZ"]);
    expect(b.holdings.map((h: Json) => [h.ticker, h.weightPct])).toEqual([
      ["AAPL", 71.4286],
      ["TGT", 28.5714],
    ]);
    expect(b.holdings.find((h: Json) => h.ticker === "TGT").thinHistory).toBe(true); // about ten days of prices
    expect(b.holdings.find((h: Json) => h.ticker === "AAPL").thinHistory).toBe(false);

    const s = (await (
      await preview(request, "shares", [
        { ticker: "AAPL", amount: 5 },
        { ticker: "ZTS", amount: 5 },
      ])
    ).json()) as Json;
    expect(s.noPrice).toEqual(["ZTS"]); // ZTS is in the index but has no prices in the fixtures
    expect(s.holdings.map((h: Json) => [h.ticker, h.weightPct])).toEqual([["AAPL", 100]]);
  });

  test("rejects bad input and portfolios that are too large", async ({ request }) => {
    expect((await preview(request, "weights", [])).status()).toBe(400);
    expect((await preview(request, "weights", [{ ticker: "AAPL", amount: -5 }])).status()).toBe(
      400,
    );
    expect((await preview(request, "weights", [{ ticker: "AAPL", amount: 0 }])).status()).toBe(400);
    expect(
      (await preview(request, "weights", [{ ticker: "not a ticker", amount: 5 }])).status(),
    ).toBe(400);
    expect((await preview(request, "grams", [{ ticker: "AAPL", amount: 5 }])).status()).toBe(400);
    const found = new Set<string>();
    for (const letter of "ABCDEFGHIJKLMNOPRSTUVW") {
      const r = (await (await request.get(`/api/companies?q=${letter}`)).json()) as {
        companies: { ticker: string }[];
      };
      r.companies.forEach((c) => found.add(c.ticker));
      if (found.size >= 55) break;
    }
    const tickers = [...found].slice(0, 51);
    expect(tickers).toHaveLength(51);
    const big = await preview(
      request,
      "weights",
      tickers.map((ticker) => ({ ticker, amount: 1 })),
    );
    expect(big.status()).toBe(400);
    expect(((await big.json()) as Json).error.message).toContain("up to 50");
  });
});

test.describe("import page", () => {
  test("paste a list, check it, create the portfolio, and see it on the dashboard", async ({
    page,
  }) => {
    await startUiSession(page);
    await page.goto("/portfolios/new");
    await page.getByRole("button", { name: "Use an example" }).click();
    await page.getByRole("button", { name: "Check holdings" }).click();
    const region = page.getByRole("region", { name: "Import preview" });
    await expect(region.getByTestId("import-summary")).toContainText(
      "Understood 5 holdings as percentages of the portfolio.",
    );
    const table = region.getByRole("table", { name: "Imported holdings" });
    await expect(table.locator("tbody tr")).toHaveCount(5);
    await expect(table.getByRole("row", { name: /AAPL/ })).toContainText("25.00%");
    await region.getByLabel("Portfolio name").fill("From my broker");
    await region.getByRole("button", { name: "Create portfolio" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    const list = (await (await page.request.get("/api/portfolios")).json()) as {
      portfolios: { name: string }[];
    };
    expect(list.portfolios.map((p) => p.name)).toContain("From my broker");
  });

  test("switching what the numbers mean re-reads them, and skipped lines are listed with reasons", async ({
    page,
  }) => {
    await startUiSession(page);
    await page.goto("/portfolios/new");
    await page
      .getByLabel("Paste holdings")
      .fill("Symbol,Quantity\nAAPL,10\nMSFT,5\nCASH,200\nFoo Corp,4");
    await page.getByRole("button", { name: "Check holdings" }).click();
    const region = page.getByRole("region", { name: "Import preview" });
    await expect(region.getByTestId("import-summary")).toContainText("as numbers of shares");
    await expect(region.getByText("2 lines skipped")).toBeVisible();
    await region.getByText("2 lines skipped").click();
    const skipped = region.getByRole("list", { name: "Skipped lines" });
    await expect(skipped).toContainText("Not a holding");
    await expect(skipped).toContainText("is not a ticker");
    const sharesWeights = await region
      .getByRole("table", { name: "Imported holdings" })
      .innerText();
    await region.getByLabel("percentages of the portfolio").check();
    await expect(region.getByTestId("import-summary")).toContainText(
      "as percentages of the portfolio",
    );
    await expect(region.getByRole("table", { name: "Imported holdings" })).not.toHaveText(
      sharesWeights,
    );
  });

  test("says what is wrong when nothing can be read, and reports tickers it does not cover", async ({
    page,
  }) => {
    await startUiSession(page);
    await page.goto("/portfolios/new");
    await page.getByLabel("Paste holdings").fill("hello there");
    await page.getByRole("button", { name: "Check holdings" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "No holdings found" })).toBeVisible();
    await page.getByLabel("Paste holdings").fill("AAPL 50\nZZZZ 50");
    await page.getByRole("button", { name: "Check holdings" }).click();
    await expect(page.getByTestId("import-summary")).toContainText("not in the S&P 500: ZZZZ");
    await expect(
      page.getByRole("table", { name: "Imported holdings" }).locator("tbody tr"),
    ).toHaveCount(1);
  });

  test("a CSV file can be loaded, and the page has no accessibility violations with a preview showing", async ({
    page,
  }) => {
    await startUiSession(page);
    await page.goto("/portfolios/new");
    await page.getByLabel("Load a CSV file").setInputFiles({
      name: "holdings.csv",
      mimeType: "text/csv",
      buffer: Buffer.from('Symbol,Market Value\nAAPL,"$5,000.00"\nMSFT,"$5,000.00"\n'),
    });
    await expect(page.getByLabel("Paste holdings")).toHaveValue(/AAPL/);
    await page.getByRole("button", { name: "Check holdings" }).click();
    await expect(page.getByTestId("import-summary")).toContainText("as dollar values");
    await expect(
      page.getByRole("table", { name: "Imported holdings" }).getByRole("row", { name: /MSFT/ }),
    ).toContainText("50.00%");
    // Let button colour transitions finish so contrast is measured on final colours.
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
    );
    const r = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);
  });
});
