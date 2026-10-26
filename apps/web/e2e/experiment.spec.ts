import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { BASE } from "./helpers";
import { EXPERIMENT_TOKEN } from "./env";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Playwright = {
  request: { newContext: (o: { baseURL: string }) => Promise<APIRequestContext> };
};

const ADMIN = { "x-admin-token": EXPERIMENT_TOKEN };
const PRE = { perceivedDiversification: 3, confidence: 4 };
const POST = { perceivedDiversification: 6, confidence: 5 };
const FIVE = [
  { ticker: "NVDA", weightPct: 30 },
  { ticker: "AAPL", weightPct: 25 },
  { ticker: "MSFT", weightPct: 20 },
  { ticker: "AMZN", weightPct: 15 },
  { ticker: "COST", weightPct: 10 },
];

async function enrolled(playwright: Playwright, experience = "intermediate") {
  const ctx = await playwright.request.newContext({ baseURL: BASE });
  const r = await ctx.post("/api/experiment/enroll", {
    data: { consent: true, ageGroup: "adult", experience, pre: PRE },
  });
  expect(r.status(), await r.text()).toBe(201);
  const arm = ((await r.json()) as Json).participant.arm as "control" | "treatment";
  return { ctx, arm };
}

/** Enrolls participants (intermediate stratum) until one of each arm exists. */
async function bothArms(playwright: Playwright) {
  const found: Partial<Record<"control" | "treatment", APIRequestContext>> = {};
  for (let i = 0; i < 6 && !(found.control && found.treatment); i++) {
    const p = await enrolled(playwright);
    found[p.arm] ??= p.ctx;
  }
  expect(found.control && found.treatment).toBeTruthy();
  return { control: found.control!, treatment: found.treatment! };
}

async function csv(ctx: APIRequestContext): Promise<Json[]> {
  const r = await ctx.get("/api/experiment/export", { headers: ADMIN });
  expect(r.status()).toBe(200);
  const [head, ...rows] = (await r.text()).trim().split("\n");
  const cols = head!.split(",");
  return rows.map((line) => Object.fromEntries(line.split(",").map((v, i) => [cols[i]!, v])));
}

test.describe("study API", () => {
  test("reports its status and limits when nobody is enrolled", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: BASE });
    const b = (await (await ctx.get("/api/experiment")).json()) as Json;
    expect(b).toMatchObject({
      enabled: true,
      participant: null,
      limits: { minHoldings: 5, maxHoldings: 10, minWeightPct: 1 },
      study: {
        researcher: "E2E Researcher, Test School",
        approval: "Test approver, 2026-10-01",
        contact: "study@example.org",
        end: "2026-12-31",
        allowMinors: true,
      },
    });
    expect((await ctx.get("/api/experiment/universe")).status()).toBe(401);
  });

  test("enrollment needs consent, an experience level and valid answers", async ({
    playwright,
  }) => {
    const ctx = await playwright.request.newContext({ baseURL: BASE });
    const post = (data: Json) =>
      ctx.post("/api/experiment/enroll", { data: { ageGroup: "adult", ...data } });
    expect((await post({ consent: false, experience: "novice", pre: PRE })).status()).toBe(400);
    expect(
      (await post({ consent: true, ageGroup: "child", experience: "novice", pre: PRE })).status(),
    ).toBe(400);
    expect((await post({ consent: true, experience: "guru", pre: PRE })).status()).toBe(400);
    expect(
      (
        await post({ consent: true, experience: "novice", pre: { ...PRE, confidence: 0 } })
      ).status(),
    ).toBe(400);
    expect(
      (
        await post({ consent: true, experience: "novice", pre: { ...PRE, confidence: 8 } })
      ).status(),
    ).toBe(400);
    const rows = (await csv(ctx)).length;
    expect(rows).toBeGreaterThanOrEqual(0);
  });

  test("a minor can take part only with a guardian's consent, and only the age group is stored", async ({
    playwright,
  }) => {
    const ctx = await playwright.request.newContext({ baseURL: BASE });
    const post = (data: Json) =>
      ctx.post("/api/experiment/enroll", {
        data: { consent: true, ageGroup: "minor", experience: "novice", pre: PRE, ...data },
      });
    const refused = await post({});
    expect(refused.status()).toBe(400);
    expect(((await refused.json()) as Json).error.message).toMatch(/parent or guardian/);
    expect((await post({ guardianConsent: false })).status()).toBe(400);
    expect((await post({ guardianConsent: true })).status()).toBe(201);
    const id = (await ctx.storageState()).cookies
      .find((c) => c.name === "pl_exp")!
      .value.split(".")[0];
    const mine = (await csv(ctx)).find((r) => r.participant_id === id)!;
    expect(mine).toMatchObject({ age_group: "minor", pilot: "false" });
  });

  test("a second enrollment from the same browser does not create another participant", async ({
    playwright,
  }) => {
    const { ctx, arm } = await enrolled(playwright);
    const before = (await csv(ctx)).length;
    const again = await ctx.post("/api/experiment/enroll", {
      data: { consent: true, ageGroup: "adult", experience: "expert", pre: PRE },
    });
    expect(again.status()).toBe(200);
    expect(((await again.json()) as Json).participant.arm).toBe(arm);
    expect((await csv(ctx)).length).toBe(before);
  });

  test("randomization keeps the arms within one participant of each other in every stratum", async ({
    playwright,
  }) => {
    for (let i = 0; i < 9; i++) await enrolled(playwright, "expert");
    for (let i = 0; i < 4; i++) await enrolled(playwright, "novice");
    const rows = await csv(await playwright.request.newContext({ baseURL: BASE }));
    for (const stratum of ["novice", "intermediate", "expert"]) {
      const inStratum = rows.filter((r) => r.experience === stratum);
      const c = inStratum.filter((r) => r.arm === "control").length;
      expect(Math.abs(c - (inStratum.length - c)), stratum).toBeLessThanOrEqual(1);
    }
    expect(rows.filter((r) => r.experience === "expert").length).toBeGreaterThanOrEqual(9);
  });

  test("the control arm is never sent hidden-exposure information; the treatment arm is", async ({
    playwright,
  }) => {
    const { control, treatment } = await bothArms(playwright);
    const cu = (await (await control.get("/api/experiment/universe")).json()) as Json;
    const tu = (await (await treatment.get("/api/experiment/universe")).json()) as Json;
    expect(cu.companies).toHaveLength(10);
    expect(cu.companies.every((c: Json) => !("exposures" in c))).toBe(true);
    expect(JSON.stringify(cu)).not.toMatch(/exposure|factor/i);
    const nvda = tu.companies.find((c: Json) => c.ticker === "NVDA");
    expect(nvda.exposures).toContainEqual({ factor: "AI infrastructure capex", signed: 3 });

    const cp = (await (
      await control.post("/api/experiment/preview", { data: { holdings: FIVE } })
    ).json()) as Json;
    const tp = (await (
      await treatment.post("/api/experiment/preview", { data: { holdings: FIVE } })
    ).json()) as Json;
    expect(JSON.stringify(cp)).not.toMatch(/factor|hhi|loading/i);
    expect(cp.volatility).toBeGreaterThan(0);
    expect(cp.sectors.length).toBeGreaterThan(0);
    expect(cp.averageCorrelation).not.toBeNull();
    // identical common measures in both arms
    expect(tp.volatility).toBeCloseTo(cp.volatility, 12);
    expect(tp.effectiveSectors).toBeCloseTo(cp.effectiveSectors, 12);

    // hand-computed loadings: ai 1.45, taiwan -1.4, china 1.1, rates -1.05, consumer 1.5; abs sum 6.5
    const hhi = (1.45 ** 2 + 1.4 ** 2 + 1.1 ** 2 + 1.05 ** 2 + 1.5 ** 2) / 6.5 ** 2;
    expect(tp.factor.effectiveFactors).toBeCloseTo(1 / hhi, 8);
    expect(tp.factor.topFactorShare).toBeCloseTo(1.5 / 6.5, 8);
  });

  test("rejects invalid portfolios", async ({ playwright }) => {
    const { ctx } = await enrolled(playwright);
    const prev = (holdings: unknown) => ctx.post("/api/experiment/preview", { data: { holdings } });
    expect((await prev(FIVE.slice(0, 4))).status()).toBe(400); // too few
    expect((await prev([...FIVE.slice(0, 4), { ticker: "NVDA", weightPct: 10 }])).status()).toBe(
      400,
    ); // duplicate
    expect((await prev(FIVE.map((h) => ({ ...h, weightPct: 19 })))).status()).toBe(400); // not 100
    expect((await prev([...FIVE.slice(0, 4), { ticker: "XOM", weightPct: 10 }])).status()).toBe(
      400,
    ); // outside universe
    expect(
      (
        await prev([
          ...FIVE.slice(0, 3).map((h) => ({ ...h })),
          { ticker: "AMZN", weightPct: 25 },
          { ticker: "COST", weightPct: 0.5 },
          { ticker: "MCD", weightPct: 0.5 },
        ])
      ).status(),
    ).toBe(400); // weights below the minimum
    expect((await prev("nope")).status()).toBe(400);
  });

  test("a submission stores the pre-registered outcome computed on the server, once", async ({
    playwright,
  }) => {
    const { ctx, arm } = await enrolled(playwright);
    const before = (await csv(ctx)).length;
    const r = await ctx.post("/api/experiment/submit", { data: { holdings: FIVE, post: POST } });
    expect(r.status(), await r.text()).toBe(201);
    const rows = await csv(ctx);
    expect(rows).toHaveLength(before);
    const id = (await ctx.storageState()).cookies
      .find((c) => c.name === "pl_exp")!
      .value.split(".")[0];
    const mine = rows.find((x) => x.participant_id === id);
    expect(mine).toBeDefined();
    expect(mine).toMatchObject({
      arm,
      completed: "true",
      n_holdings: "5",
      post_perceived_diversification: "6",
    });
    const hhi = (1.45 ** 2 + 1.4 ** 2 + 1.1 ** 2 + 1.05 ** 2 + 1.5 ** 2) / 6.5 ** 2;
    expect(Number(mine!.factor_hhi)).toBeCloseTo(hhi, 10);
    expect(Number(mine!.effective_factors)).toBeCloseTo(1 / hhi, 8);
    // the return-based robustness outcome lies between one bet and one per holding
    expect(Number(mine!.effective_bets)).toBeGreaterThanOrEqual(1);
    expect(Number(mine!.effective_bets)).toBeLessThanOrEqual(5);
    expect(Number(mine!.seconds_to_submit)).toBeGreaterThanOrEqual(0);

    expect(
      (await ctx.post("/api/experiment/submit", { data: { holdings: FIVE, post: POST } })).status(),
    ).toBe(409);
    expect((await ctx.get("/api/experiment")).ok()).toBe(true);
    const done = ((await (await ctx.get("/api/experiment")).json()) as Json).participant;
    expect(done.completed).toBe(true);
    expect(done.result).toMatchObject({ nHoldings: 5 });
    expect(done.result.effectiveFactors).toBeCloseTo(1 / hhi, 8);
  });

  test("logs interaction events and rejects unknown event types", async ({ playwright }) => {
    const { ctx } = await enrolled(playwright);
    const ok = await ctx.post("/api/experiment/events", {
      data: {
        events: [{ type: "add_holding", payload: { ticker: "NVDA" } }, { type: "page_hidden" }],
      },
    });
    expect(ok.status()).toBe(201);
    expect(((await ok.json()) as Json).logged).toBe(2);
    expect(
      (
        await ctx.post("/api/experiment/events", { data: { events: [{ type: "drop_table" }] } })
      ).status(),
    ).toBe(400);
    expect((await ctx.post("/api/experiment/events", { data: { events: [] } })).status()).toBe(400);
    const rows = await csv(ctx);
    expect(Math.max(...rows.map((r) => Number(r.n_events)))).toBeGreaterThanOrEqual(3); // enrolled + 2
    const anon = await ctx.storageState();
    expect(anon.cookies.find((c) => c.name === "pl_exp")?.httpOnly).toBe(true);
  });

  test("withdrawing deletes the participant's data and clears the cookie", async ({
    playwright,
  }) => {
    const { ctx } = await enrolled(playwright);
    await ctx.post("/api/experiment/submit", { data: { holdings: FIVE, post: POST } });
    const before = (await csv(ctx)).length;
    expect((await ctx.delete("/api/experiment/participant")).status()).toBe(200);
    expect((await csv(ctx)).length).toBe(before - 1);
    expect(((await (await ctx.get("/api/experiment")).json()) as Json).participant).toBeNull();
    expect((await ctx.delete("/api/experiment/participant")).status()).toBe(401);
  });

  test("a participant cannot reach the rest of the app, so the control arm cannot find exposure data", async ({
    playwright,
  }) => {
    const { control } = await bothArms(playwright);
    for (const url of [
      "/api/portfolios",
      "/api/research/NVDA",
      "/api/companies?q=nvd",
      "/api/events",
      "/api/samples",
    ]) {
      const r = await control.get(url);
      expect(r.status(), url).toBe(403);
      expect(((await r.json()) as Json).error.code).toBe("forbidden");
    }
    expect((await control.post("/api/session")).status()).toBe(403);
    expect((await control.get("/api/health")).status()).toBe(200);
    expect((await control.get("/api/experiment")).status()).toBe(200);
  });

  test("an edited or invented participant cookie is not accepted", async ({ playwright }) => {
    const { ctx } = await enrolled(playwright);
    const real = (await ctx.storageState()).cookies.find((c) => c.name === "pl_exp")!.value;
    const [id, sig] = real.split(".");
    const status = async (cookie: string) =>
      (
        (await (
          await ctx.get("/api/experiment", { headers: { cookie: `pl_exp=${cookie}` } })
        ).json()) as Json
      ).participant;
    expect(await status(real)).not.toBeNull();
    expect(await status(`${id}.${sig!.replace(/.$/, sig!.endsWith("0") ? "1" : "0")}`)).toBeNull(); // wrong signature
    expect(await status(`${id!.replace(/.$/, id!.endsWith("0") ? "1" : "0")}.${sig}`)).toBeNull(); // wrong id
    expect(await status(id!)).toBeNull(); // unsigned
    expect(await status("00000000-0000-4000-8000-000000000000.abc")).toBeNull();
    expect(((await (await ctx.get("/api/experiment")).json()) as Json).participant).not.toBeNull();
  });

  test("the export and results are for the researcher only", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: BASE });
    for (const url of ["/api/experiment/export", "/api/experiment/results"]) {
      expect((await ctx.get(url)).status()).toBe(403);
      expect(
        (await ctx.get(url, { headers: { "x-admin-token": "wrong-token-wrong-token" } })).status(),
      ).toBe(403);
    }
    const res = await ctx.get("/api/experiment/results", { headers: ADMIN });
    expect(res.status()).toBe(200);
    const b = (await res.json()) as Json;
    expect(b.plannedPerArm).toEqual({ smallEffect: 393, mediumEffect: 63, largeEffect: 25 });
    expect(b.primary.name).toBe("factor_hhi");
    expect(b.primary.nControl + b.primary.nTreatment).toBe(b.completed);
    // these submissions are fast, so the pre-registered sensitivity check drops them
    expect(b.primaryExcludingFast.excluded).toBe(b.completed);
    expect(b.secondary.map((o: Json) => o.name)).toContain("effective_bets");
    expect(b.pilot).toMatchObject({ completed: 0, factorHhiSd: null });
    const file = await ctx.get("/api/experiment/export", { headers: ADMIN });
    expect(file.headers()["content-type"]).toContain("text/csv");
    expect(await file.text()).toMatch(/^participant_id,arm,experience,/);
  });
});

async function dismissToTask(page: Page, experience = "Some experience") {
  await page.goto("/experiment");
  await expect(
    page.getByRole("heading", { name: "Portfolio construction study", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "study@example.org" })).toBeVisible();
  const start = page.getByRole("button", { name: "Start the task" });
  await expect(start).toBeDisabled();
  await page.getByLabel("I have read this information and agree to take part.").check();
  await page.getByLabel("18 or over").check();
  await page.getByLabel(experience).check();
  await page
    .getByRole("group", { name: "How well diversified would you say you are as an investor?" })
    .getByLabel("3", { exact: true })
    .check();
  await page
    .getByRole("group", {
      name: "How confident are you in your ability to build a diversified portfolio?",
    })
    .getByLabel("4", { exact: true })
    .check();
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.getByText("Your task.")).toBeVisible();
}

test.describe("study page", () => {
  test("consent, build a portfolio, see the arm's summary, submit and withdraw", async ({
    page,
  }) => {
    await dismissToTask(page);
    const arm = ((await (await page.request.get("/api/experiment")).json()) as Json).participant
      .arm as string;

    const list = page.getByRole("list", { name: "Companies" });
    await expect(list.locator("li")).toHaveCount(10);
    for (const t of ["NVDA", "AAPL", "MSFT", "AMZN", "COST"])
      await page.getByRole("button", { name: `Add ${t}` }).click();
    await expect(page.getByRole("list", { name: "Your portfolio" }).locator("li")).toHaveCount(5);
    await expect(page.getByRole("region", { name: "Portfolio summary" })).toHaveCount(0);
    await page.getByRole("button", { name: "Equal weights" }).click();
    await expect(page.getByTestId("weight-total")).toContainText("Total 100% of 100%");

    const summary = page.getByRole("region", { name: "Portfolio summary" });
    await expect(summary).toContainText("Effective sectors");
    await expect(summary).toContainText("Annualized volatility");
    if (arm === "treatment") {
      await expect(summary).toContainText("Effective hidden factors");
      await expect(list).toContainText("Hidden exposures");
    } else {
      await expect(summary).not.toContainText("hidden");
      await expect(list).not.toContainText("Hidden exposures");
    }

    const submit = page.getByRole("button", { name: "Submit portfolio" });
    await expect(submit).toBeDisabled();
    await page
      .getByRole("group", { name: "How well diversified is the portfolio you built?" })
      .getByLabel("6", { exact: true })
      .check();
    await page
      .getByRole("group", { name: "How confident are you in this portfolio?" })
      .getByLabel("5", { exact: true })
      .check();
    await submit.click();
    await expect(page.getByText("Thank you. Your answers have been recorded.")).toBeVisible();
    await expect(page.getByText("About this study")).toBeVisible();
    await expect(page.getByText(/randomly assigned to one of two versions/)).toBeVisible();
    await expect(page.getByTestId("debrief-arm")).toContainText(
      arm === "treatment" ? "with hidden exposures" : "without hidden exposures",
    );
    await expect(page.getByTestId("debrief-result")).toContainText("independent economic forces");
    await expect(
      page.getByText(/Please do not discuss the study .* before 2026-12-31/),
    ).toBeVisible();

    await page.getByRole("button", { name: "Withdraw and delete my data" }).click();
    await page.getByRole("button", { name: "Confirm withdrawal" }).click();
    await expect(page.getByText("Before you start", { exact: true })).toBeVisible();
  });

  test("weights that do not add up block the summary and the submit button, with a reason", async ({
    page,
  }) => {
    await dismissToTask(page);
    for (const t of ["NVDA", "AAPL", "MSFT", "AMZN", "COST"])
      await page.getByRole("button", { name: `Add ${t}` }).click();
    await page.getByRole("button", { name: "Equal weights" }).click();
    await page.getByLabel("Weight for NVDA in percent").fill("35");
    await expect(page.getByTestId("weight-total")).toContainText("Total 115% of 100%");
    await expect(page.getByText(/adding up to 100%, to see the portfolio summary/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Portfolio summary" })).toHaveCount(0);
    await page.getByRole("button", { name: "Remove NVDA" }).click();
    await expect(page.getByText(/Choose 5 to 10 companies/)).toBeVisible();
    // the cap on holdings
    for (const t of ["NVDA", "MCD", "NKE", "SBUX", "LOW", "TJX"])
      await page.getByRole("button", { name: `Add ${t}` }).click();
    await expect(page.getByRole("list", { name: "Your portfolio" }).locator("li")).toHaveCount(10);
    await expect(page.getByRole("button", { name: /^Added / })).toHaveCount(10);
  });

  test("a minor needs a guardian's consent before the task can start", async ({ page }) => {
    await page.goto("/experiment");
    await page.getByLabel("I have read this information and agree to take part.").check();
    await page.getByLabel("Under 18").check();
    await page.getByLabel("New to investing").check();
    await page
      .getByRole("group", { name: "How well diversified would you say you are as an investor?" })
      .getByLabel("3", { exact: true })
      .check();
    await page
      .getByRole("group", {
        name: "How confident are you in your ability to build a diversified portfolio?",
      })
      .getByLabel("4", { exact: true })
      .check();
    const start = page.getByRole("button", { name: "Start the task" });
    await expect(start).toBeDisabled();
    await page
      .getByLabel("A parent or guardian has signed the consent form for this study.")
      .check();
    await expect(start).toBeEnabled();
  });

  test("leaving the study page for the rest of the app is not possible once enrolled", async ({
    page,
  }) => {
    await dismissToTask(page);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/experiment$/);
    await page.goto("/research/NVDA");
    await expect(page).toHaveURL(/\/experiment$/);
    await expect(page.getByText("Your task.")).toBeVisible();
  });

  test("the consent page and the task page have no accessibility violations", async ({ page }) => {
    const scan = async () => {
      const r = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);
    };
    await page.goto("/experiment");
    await expect(page.getByText("Before you start", { exact: true })).toBeVisible();
    await scan();
    await dismissToTask(page);
    for (const t of ["NVDA", "AAPL", "MSFT", "AMZN", "COST"])
      await page.getByRole("button", { name: `Add ${t}` }).click();
    await page.getByRole("button", { name: "Equal weights" }).click();
    await expect(page.getByRole("region", { name: "Portfolio summary" })).toBeVisible();
    await scan();
  });
});
