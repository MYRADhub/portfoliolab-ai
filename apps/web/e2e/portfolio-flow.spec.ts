import { expect, test } from "@playwright/test";
import {
  COVERED,
  EXAMPLE,
  appAlert,
  holdingsCard,
  startUiSession,
  waitForDashboard,
} from "./helpers";

test.describe("first visit", () => {
  test("the root redirects to the dashboard, which invites creating a portfolio", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("You have no portfolios yet.")).toBeVisible();
    await page.getByRole("link", { name: "Create a portfolio" }).click();
    await expect(page).toHaveURL(/\/portfolios\/new$/);
    await expect(page.getByRole("heading", { name: "New portfolio" })).toBeVisible();
  });

  test("a session cookie is issued on first load and survives a reload", async ({
    page,
    context,
  }) => {
    await page.goto("/dashboard");
    await expect
      .poll(async () => (await context.cookies()).find((c) => c.name === "pl_session"))
      .toBeTruthy();
    const cookie = (await context.cookies()).find((c) => c.name === "pl_session")!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    await page.reload();
    expect((await context.cookies()).find((c) => c.name === "pl_session")!.value).toBe(
      cookie.value,
    );
  });
});

test.describe("portfolio form", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/portfolios/new");
    await expect(page.getByLabel("Ticker 1")).toBeVisible();
  });

  test("starts with two empty rows, a default name and a zero total", async ({ page }) => {
    await expect(page.getByLabel("Name")).toHaveValue("My portfolio");
    await expect(page.getByLabel(/^Ticker \d$/)).toHaveCount(2);
    await expect(page.getByText("Total: 0.00%")).toBeVisible();
  });

  test("the total updates live as weights are typed", async ({ page }) => {
    await page.getByLabel("Weight 1").fill("25.5");
    await expect(page.getByText("Total: 25.50%")).toBeVisible();
    await page.getByLabel("Weight 2").fill("74.5");
    await expect(page.getByText("Total: 100.00%")).toBeVisible();
    await page.getByLabel("Weight 2").fill("abc");
    await expect(page.getByText("Total: 25.50%")).toBeVisible();
  });

  test("rows can be added and removed, and the last row cannot be removed", async ({ page }) => {
    await page.getByRole("button", { name: "Add holding" }).click();
    await page.getByRole("button", { name: "Add holding" }).click();
    await expect(page.getByLabel(/^Ticker \d$/)).toHaveCount(4);
    await page.getByLabel("Ticker 3").fill("MSFT");
    await page.getByRole("button", { name: "Remove row 1" }).click();
    await expect(page.getByLabel(/^Ticker \d$/)).toHaveCount(3);
    await expect(page.getByLabel("Ticker 2")).toHaveValue("MSFT");
    await page.getByRole("button", { name: "Remove row 1" }).click();
    await page.getByRole("button", { name: "Remove row 1" }).click();
    await expect(page.getByLabel(/^Ticker \d$/)).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Remove row 1" })).toBeDisabled();
  });

  test("tickers are upper-cased as typed and autocomplete suggests matching companies", async ({
    page,
  }) => {
    await page.getByLabel("Ticker 1").fill("ms");
    await expect(page.getByLabel("Ticker 1")).toHaveValue("MS");
    await expect(page.locator("datalist option[value='MSFT']")).toHaveCount(1);
    await expect(page.locator("datalist option[value='MSFT']")).toHaveText("Microsoft");
  });

  test("shows a clear message when weights do not sum to 100", async ({ page }) => {
    await page.getByLabel("Ticker 1").fill("NVDA");
    await page.getByLabel("Weight 1").fill("50");
    await page.getByLabel("Ticker 2").fill("AAPL");
    await page.getByLabel("Weight 2").fill("20");
    await page.getByRole("button", { name: "Create portfolio" }).click();
    await expect(appAlert(page)).toHaveText("Weights sum to 70.00%, expected 100%");
    await expect(page).toHaveURL(/\/portfolios\/new$/);
  });

  test("shows a clear message for unknown tickers and duplicate tickers", async ({ page }) => {
    await page.getByLabel("Ticker 1").fill("NVDA");
    await page.getByLabel("Weight 1").fill("50");
    await page.getByLabel("Ticker 2").fill("ZZZZ");
    await page.getByLabel("Weight 2").fill("50");
    await page.getByRole("button", { name: "Create portfolio" }).click();
    await expect(appAlert(page)).toHaveText("Unknown tickers: ZZZZ");
    await page.getByLabel("Ticker 2").fill("NVDA");
    await page.getByRole("button", { name: "Create portfolio" }).click();
    await expect(appAlert(page)).toHaveText("NVDA appears more than once");
  });

  test("a row with a ticker but no weight gets a helpful message, and blank rows are ignored", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Add holding" }).click();
    await page.getByLabel("Ticker 1").fill("NVDA");
    await page.getByLabel("Weight 1").fill("100");
    await page.getByLabel("Ticker 2").fill("AAPL");
    await page.getByRole("button", { name: "Create portfolio" }).click();
    // An empty weight is read as 0.
    await expect(appAlert(page)).toHaveText("AAPL must have a weight above 0");
    await page.getByLabel("Weight 2").fill("abc");
    await page.getByRole("button", { name: "Create portfolio" }).click();
    await expect(appAlert(page)).toHaveText(
      "Check that every row has a valid ticker and a numeric weight.",
    );
    await page.getByLabel("Ticker 2").fill("");
    await page.getByLabel("Weight 2").fill("");
    await page.getByRole("button", { name: "Create portfolio" }).click(); // rows 2 and 3 are blank and ignored
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("rescaling accepts weights that do not sum to 100", async ({ page }) => {
    await page.getByLabel("Name").fill("Rescaled");
    await page.getByLabel("Ticker 1").fill("NVDA");
    await page.getByLabel("Weight 1").fill("1");
    await page.getByLabel("Ticker 2").fill("AAPL");
    await page.getByLabel("Weight 2").fill("3");
    await page.getByLabel("Rescale weights to 100%").check();
    await page.getByRole("button", { name: "Create portfolio" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await waitForDashboard(page);
    await expect(holdingsCard(page).getByRole("row", { name: /AAPL.*75\.0%/ })).toBeVisible();
    await expect(holdingsCard(page).getByRole("row", { name: /NVDA.*25\.0%/ })).toBeVisible();
  });

  test("pressing Enter in a weight field submits the form", async ({ page }) => {
    await page.getByLabel("Ticker 1").fill("NVDA");
    await page.getByLabel("Weight 1").fill("60");
    await page.getByLabel("Ticker 2").fill("AAPL");
    await page.getByLabel("Weight 2").fill("40");
    await page.getByLabel("Weight 2").press("Enter");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("the submit button is disabled while the request is in flight, so double clicks create one portfolio", async ({
    page,
  }) => {
    await page.getByLabel("Name").fill("Once");
    await page.getByLabel("Ticker 1").fill("NVDA");
    await page.getByLabel("Weight 1").fill("60");
    await page.getByLabel("Ticker 2").fill("AAPL");
    await page.getByLabel("Weight 2").fill("40");
    await page.getByRole("button", { name: "Create portfolio" }).dblclick();
    await expect(page).toHaveURL(/\/dashboard$/);
    const list = (await (await page.request.get("/api/portfolios")).json()) as {
      portfolios: { name: string }[];
    };
    expect(list.portfolios.filter((p) => p.name === "Once")).toHaveLength(1);
  });
});

test.describe("session recovery", () => {
  test("submitting after the session cookie is lost creates a new session and still succeeds", async ({
    page,
    context,
  }) => {
    await page.goto("/portfolios/new");
    await expect
      .poll(async () => (await context.cookies()).some((c) => c.name === "pl_session"))
      .toBe(true);
    await page.getByLabel("Name").fill("Recovered");
    await page.getByLabel("Ticker 1").fill("NVDA");
    await page.getByLabel("Weight 1").fill("60");
    await page.getByLabel("Ticker 2").fill("AAPL");
    await page.getByLabel("Weight 2").fill("40");
    await context.clearCookies();
    await page.getByRole("button", { name: "Create portfolio" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await waitForDashboard(page);
    const list = (await (await page.request.get("/api/portfolios")).json()) as {
      portfolios: { name: string }[];
    };
    expect(list.portfolios.map((p) => p.name)).toEqual(["Recovered"]);
  });

  test("an expired cookie on the dashboard shows the empty state instead of an error", async ({
    page,
    context,
  }) => {
    const s = await startUiSession(page);
    await s.create("Gone", EXAMPLE);
    await context.clearCookies();
    await page.reload();
    await expect(page.getByText("You have no portfolios yet.")).toBeVisible();
    await expect(appAlert(page)).toHaveCount(0);
  });
});

test.describe("dashboard", () => {
  test("shows KPIs, three charts and the holdings table for the example portfolio", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Example", EXAMPLE);
    await page.reload();
    await waitForDashboard(page);

    for (const label of [
      "Total return",
      "Annualized return",
      "Volatility (ann.)",
      "Max drawdown",
      "Sharpe",
    ]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByText(/^[+-]\d+\.\d%$/).first()).toBeVisible();
    await expect(
      page.getByText(
        /trading days\)\. Constant target weights, rebalanced daily\. Risk-free rate 0\.0%\./,
      ),
    ).toBeVisible();
    await expect(page.locator(".recharts-surface")).toHaveCount(4);
    await expect(page.getByText("Growth of 1.00")).toBeVisible();
    await expect(page.getByText("Drawdown", { exact: true })).toBeVisible();
    await expect(page.getByText("Sector allocation")).toBeVisible();
    await expect(
      page.getByText("Holdings (effective number of positions 4.9, largest 25%)"),
    ).toBeVisible();

    const rows = holdingsCard(page).getByRole("row");
    await expect(rows).toHaveCount(6); // header + five holdings
    for (const [t, w] of [
      ["AAPL", "20.0%"],
      ["AMZN", "15.0%"],
      ["JPM", "20.0%"],
      ["MSFT", "20.0%"],
      ["NVDA", "25.0%"],
    ] as const) {
      await expect(
        holdingsCard(page).getByRole("row", { name: new RegExp(`${t}.*${w}`) }),
      ).toBeVisible();
    }
  });

  test("KPI values on screen match the API", async ({ page }) => {
    const s = await startUiSession(page);
    const id = await s.create("Match", EXAMPLE);
    await page.reload();
    await waitForDashboard(page);
    const a = (await (await page.request.get(`/api/portfolios/${id}/analytics`)).json()) as {
      stats: Record<string, number>;
    };
    const signed = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
    await expect(page.getByText(signed(a.stats.totalReturn!), { exact: true })).toBeVisible();
    await expect(page.getByText(signed(a.stats.annualizedReturn!), { exact: true })).toBeVisible();
    await expect(
      page.getByText(`${(a.stats.annualizedVolatility! * 100).toFixed(1)}%`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(`${(a.stats.maxDrawdown! * 100).toFixed(1)}%`, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(a.stats.sharpe!.toFixed(2), { exact: true })).toBeVisible();
  });

  test("with several portfolios a selector switches between them", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Mega caps", EXAMPLE);
    await s.create("Covered four", COVERED);
    await page.reload();
    await waitForDashboard(page);
    const select = page.getByLabel("Portfolio", { exact: true });
    await expect(select).toBeVisible();
    await expect(select.locator("option")).toHaveText(["Covered four", "Mega caps"]);
    await expect(holdingsCard(page).getByRole("row")).toHaveCount(5); // newest first: four holdings
    await select.selectOption({ label: "Mega caps" });
    await expect(holdingsCard(page).getByRole("row")).toHaveCount(6);
    await expect(holdingsCard(page).getByRole("row", { name: /JPM/ })).toBeVisible();
    await select.selectOption({ label: "Covered four" });
    await expect(holdingsCard(page).getByRole("row", { name: /JPM/ })).toHaveCount(0);
  });

  test("explains why a portfolio cannot be analyzed instead of failing silently", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Thin", [
      { ticker: "NVDA", weightPct: 50 },
      { ticker: "TGT", weightPct: 50 },
    ]);
    await page.reload();
    await expect(appAlert(page)).toContainText(
      "trading days of shared history; at least 30 are required",
    );
    await expect(page.getByText("Sharpe", { exact: true })).toHaveCount(0);
  });

  test("a failed portfolio does not leak into the next selection", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Good", EXAMPLE);
    await s.create("Thin", [
      { ticker: "NVDA", weightPct: 50 },
      { ticker: "TGT", weightPct: 50 },
    ]);
    await page.reload();
    await expect(appAlert(page)).toBeVisible();
    await page.getByLabel("Portfolio", { exact: true }).selectOption({ label: "Good" });
    await waitForDashboard(page);
    await expect(appAlert(page)).toHaveCount(0);
  });
});

test.describe("deleting a portfolio", () => {
  test("requires confirmation, can be cancelled, and then removes the portfolio", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Keep", EXAMPLE);
    await s.create("Remove me", COVERED);
    await page.reload();
    await waitForDashboard(page);
    await expect(page.getByLabel("Portfolio", { exact: true }).locator("option")).toHaveText([
      "Remove me",
      "Keep",
    ]);

    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("Delete this portfolio?")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Delete this portfolio?")).toHaveCount(0);
    await expect(page.getByLabel("Portfolio", { exact: true }).locator("option")).toHaveCount(2);

    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Confirm delete" }).click();
    await expect(holdingsCard(page).getByRole("row", { name: /NVDA/ })).toBeVisible(); // falls back to the remaining portfolio
    await expect(holdingsCard(page).getByRole("row")).toHaveCount(6);
    await expect(page.getByLabel("Portfolio", { exact: true })).toHaveCount(0); // a single portfolio needs no selector
    const list = (await (await page.request.get("/api/portfolios")).json()) as {
      portfolios: { name: string }[];
    };
    expect(list.portfolios.map((p) => p.name)).toEqual(["Keep"]);
  });

  test("deleting the last portfolio returns to the empty state", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Only", EXAMPLE);
    await page.reload();
    await waitForDashboard(page);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Confirm delete" }).click();
    await expect(page.getByText("You have no portfolios yet.")).toBeVisible();
  });
});

test.describe("hostile and unusual portfolio names", () => {
  const nasty = [
    `"><img src=x onerror="window.__xss=1">`,
    `<script>window.__xss=1</script>`,
    `Robert'); DROP TABLE portfolios;--`,
    `{{7*7}} \${7*7} %s %n`,
  ];

  test("render as plain text and never execute", async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    const s = await startUiSession(page);
    for (const name of nasty) await s.create(name, EXAMPLE);
    await page.reload();
    await waitForDashboard(page);
    const options = await page
      .getByLabel("Portfolio", { exact: true })
      .locator("option")
      .allTextContents();
    expect(options.sort()).toEqual([...nasty].sort());
    expect(
      await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
    ).toBeUndefined();
    expect(dialogs).toEqual([]);
    // The table that backs the app survived the SQL-looking name.
    const list = (await (await page.request.get("/api/portfolios")).json()) as {
      portfolios: unknown[];
    };
    expect(list.portfolios).toHaveLength(nasty.length);
  });

  test("long and unicode names are accepted, trimmed and shown without breaking the layout", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    const long = "L".repeat(80);
    await s.create(`  ${long}  `, EXAMPLE);
    await s.create("Портфолио 投資 🙂", COVERED);
    await page.reload();
    await waitForDashboard(page);
    const options = await page
      .getByLabel("Portfolio", { exact: true })
      .locator("option")
      .allTextContents();
    expect(options).toEqual(["Портфолио 投資 🙂", long]);
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  });
});
