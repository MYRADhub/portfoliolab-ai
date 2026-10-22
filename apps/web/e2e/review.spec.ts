import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { appAlert, BASE } from "./helpers";
import { REVIEW_TOKEN } from "./env";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const H = { "x-review-token": REVIEW_TOKEN };
const row = (slug: string, over: Json = {}) => ({
  slug,
  magnitude: 2,
  direction: 1,
  confidence: 0.9,
  rationale: "Checked against the annual report.",
  ...over,
});

async function api(playwright: {
  request: { newContext: (o: { baseURL: string }) => Promise<APIRequestContext> };
}) {
  return playwright.request.newContext({ baseURL: BASE });
}

test.describe("review API", () => {
  test("is closed without the right token", async ({ playwright }) => {
    const ctx = await api(playwright);
    for (const url of [
      "/api/review/summary",
      "/api/review/companies",
      "/api/review/companies/NKE",
    ]) {
      expect((await ctx.get(url)).status(), url).toBe(403);
      expect(
        (await ctx.get(url, { headers: { "x-review-token": "wrong-token-wrong-token" } })).status(),
      ).toBe(403);
    }
    expect(
      (
        await ctx.put("/api/review/companies/NKE", { data: { reviewer: "Ada", rows: [] } })
      ).status(),
    ).toBe(403);
  });

  test("summarizes and lists companies by status, with search", async ({ playwright }) => {
    const ctx = await api(playwright);
    const sum = (await (await ctx.get("/api/review/summary", { headers: H })).json()) as Json;
    expect(sum.draft + sum.illustrative + sum.reviewed + sum.none).toBe(sum.companies);
    expect(sum.companies).toBeGreaterThan(500);
    expect(sum.draft).toBeGreaterThanOrEqual(3); // AMZN, NKE and SBUX are fixtures drafted by AI
    const drafts = (await (
      await ctx.get("/api/review/companies?status=draft", { headers: H })
    ).json()) as Json;
    const tickers = drafts.companies.map((c: Json) => c.ticker);
    expect(tickers).toEqual(expect.arrayContaining(["AMZN", "NKE", "SBUX"]));
    expect(drafts.companies.every((c: Json) => c.status === "draft" && c.forces > 0)).toBe(true);
    const search = (await (
      await ctx.get("/api/review/companies?q=nk", { headers: H })
    ).json()) as Json;
    expect(search.companies.map((c: Json) => c.ticker)).toContain("NKE");
    expect((await ctx.get("/api/review/companies?status=bogus", { headers: H })).status()).toBe(
      400,
    );
  });

  test("returns a profile with its provenance, version and the list of forces", async ({
    playwright,
  }) => {
    const ctx = await api(playwright);
    const p = (await (await ctx.get("/api/review/companies/sbux", { headers: H })).json()) as Json;
    expect(p.company.ticker).toBe("SBUX");
    expect(p.status).toBe("draft");
    expect(p.version).toBe(1);
    expect(p.rows).toEqual([
      expect.objectContaining({
        slug: "consumer",
        magnitude: 1,
        direction: 1,
        provenance: "draft",
      }),
    ]);
    expect(p.forces.map((f: Json) => f.slug)).toEqual(
      expect.arrayContaining(["consumer", "rates", "china"]),
    );
    expect((await ctx.get("/api/review/companies/ZZZZ", { headers: H })).status()).toBe(404);
  });

  test("rejects invalid reviews", async ({ playwright }) => {
    const ctx = await api(playwright);
    const put = (data: unknown) => ctx.put("/api/review/companies/SBUX", { headers: H, data });
    expect((await put({ reviewer: "A", rows: [row("consumer")] })).status()).toBe(400); // name too short
    expect((await put({ rows: [row("consumer")] })).status()).toBe(400);
    expect(
      (await put({ reviewer: "Ada", rows: [row("consumer", { magnitude: 0 })] })).status(),
    ).toBe(400);
    expect(
      (await put({ reviewer: "Ada", rows: [row("consumer", { magnitude: 4 })] })).status(),
    ).toBe(400);
    expect(
      (await put({ reviewer: "Ada", rows: [row("consumer", { direction: 0 })] })).status(),
    ).toBe(400);
    expect(
      (await put({ reviewer: "Ada", rows: [row("consumer", { confidence: 1.5 })] })).status(),
    ).toBe(400);
    expect(
      (await put({ reviewer: "Ada", rows: [row("consumer", { rationale: "  " })] })).status(),
    ).toBe(400);
    expect((await put({ reviewer: "Ada", rows: [row("not_a_force")] })).status()).toBe(400);
    expect(
      (await put({ reviewer: "Ada", rows: [row("consumer"), row("consumer")] })).status(),
    ).toBe(400);
    // nothing changed
    const p = (await (await ctx.get("/api/review/companies/SBUX", { headers: H })).json()) as Json;
    expect(p).toMatchObject({ version: 1, status: "draft" });
  });

  test("saving closes the old version, records the reviewer, strips the draft label and updates the app", async ({
    playwright,
  }) => {
    const ctx = await api(playwright);
    const before = (await (await ctx.get("/api/review/summary", { headers: H })).json()) as Json;
    const r = await ctx.put("/api/review/companies/SBUX", {
      headers: H,
      data: {
        reviewer: "  Ada Lovelace ",
        rows: [
          row("consumer", {
            magnitude: 2,
            rationale: "AI-drafted, not reviewed: Checked against the 10-K.",
          }),
        ],
      },
    });
    expect(r.status()).toBe(200);
    const p = (await r.json()) as Json;
    expect(p).toMatchObject({ status: "reviewed", version: 2, reviewedBy: "Ada Lovelace" });
    expect(p.rows).toEqual([
      expect.objectContaining({
        slug: "consumer",
        magnitude: 2,
        confidence: 0.9,
        provenance: "reviewed",
        rationale: "Checked against the 10-K.",
      }),
    ]);
    // one profile left the draft pile
    const after = (await (await ctx.get("/api/review/summary", { headers: H })).json()) as Json;
    expect(after.draft).toBe(before.draft - 1);
    expect(after.reviewed).toBe(before.reviewed + 1);
    expect(
      (
        (await (await ctx.get("/api/review/companies?status=draft", { headers: H })).json()) as Json
      ).companies.map((c: Json) => c.ticker),
    ).not.toContain("SBUX");
    // the research page and exposures now read the reviewed values, and the old row is no longer current
    const research = (await (await ctx.get("/api/research/SBUX")).json()) as Json;
    expect(research.exposures).toHaveLength(1);
    expect(research.exposures[0]).toMatchObject({ slug: "consumer", signed: 2, confidence: 0.9 });
    // a second review makes version 3
    const again = (await (
      await ctx.put("/api/review/companies/SBUX", {
        headers: H,
        data: {
          reviewer: "Grace Hopper",
          rows: [
            row("consumer", { direction: -1 }),
            row("rates", { magnitude: 1, direction: -1, confidence: 0.6 }),
          ],
        },
      })
    ).json()) as Json;
    expect(again).toMatchObject({ version: 3, reviewedBy: "Grace Hopper" });
    expect(again.rows.map((x: Json) => x.slug).sort()).toEqual(["consumer", "rates"]);
    const sbux = (await (await ctx.get("/api/research/SBUX")).json()) as Json;
    expect(sbux.exposures.map((e: Json) => [e.slug, e.signed]).sort()).toEqual([
      ["consumer", -2],
      ["rates", -1],
    ]);
  });

  test("can create a profile and clear it again", async ({ playwright }) => {
    const ctx = await api(playwright);
    const none = (await (
      await ctx.get("/api/review/companies/XOM", { headers: H })
    ).json()) as Json;
    expect(none).toMatchObject({ status: "none", rows: [] });
    const made = (await (
      await ctx.put("/api/review/companies/XOM", {
        headers: H,
        data: { reviewer: "Ada", rows: [row("consumer")] },
      })
    ).json()) as Json;
    expect(made).toMatchObject({ status: "reviewed", version: 1 });
    const cleared = (await (
      await ctx.put("/api/review/companies/XOM", {
        headers: H,
        data: { reviewer: "Ada", rows: [] },
      })
    ).json()) as Json;
    expect(cleared).toMatchObject({ status: "none", rows: [] });
  });
});

async function unlock(page: Page) {
  await page.goto("/review");
  await page.getByLabel("Review token").fill(REVIEW_TOKEN);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByTestId("review-summary")).toBeVisible();
}

test.describe("review page", () => {
  test("asks for the token and refuses a wrong one", async ({ page }) => {
    await page.goto("/review");
    await expect(page.getByRole("heading", { name: "Exposure review", level: 1 })).toBeVisible();
    await page.getByLabel("Review token").fill("not-the-right-token-0000");
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(appAlert(page)).toHaveText("Forbidden");
    await expect(page.getByTestId("review-summary")).toHaveCount(0);
  });

  test("review a draft: edit, save, and watch it leave the pile", async ({ page }) => {
    await unlock(page);
    const summary = page.getByTestId("review-summary");
    const draftsBefore = Number(/(\d+) AI drafts/.exec(await summary.innerText())![1]);
    const list = page.getByRole("list", { name: "Companies to review" });
    await expect(list.getByRole("button", { name: /NKE/ })).toBeVisible();
    await list.getByRole("button", { name: /NKE/ }).click();

    const scores = page.getByRole("list", { name: "Exposure scores" });
    await expect(scores.locator("li")).toHaveCount(1);
    await expect(scores).toContainText("Consumer spending");
    await expect(scores).toContainText("AI draft, not reviewed");
    const save = page.getByRole("button", { name: /^Accept as reviewed$/ });
    await expect(save).toBeDisabled(); // a name is needed first
    await page.getByLabel("Your name (recorded with the review)").fill("Grace Hopper");
    await expect(save).toBeEnabled();

    await page.getByLabel("Strength for Consumer spending").selectOption("2");
    await expect(page.getByRole("button", { name: "Save changes as reviewed" })).toBeVisible();
    await page
      .getByLabel("Reason for Consumer spending")
      .fill("Checked against the annual report.");
    await page.getByRole("button", { name: "Save changes as reviewed" }).click();

    await expect(page.getByRole("status")).toHaveText(
      "Saved as version 2, reviewed by Grace Hopper.",
    );
    await expect(scores).not.toContainText("AI draft, not reviewed");
    await expect(list.getByRole("button", { name: /NKE/ })).toHaveCount(0); // no longer a draft
    await expect(summary).toContainText(`${draftsBefore - 1} AI drafts`);
  });

  test("can add and remove forces, and discard changes", async ({ page }) => {
    await unlock(page);
    await page.getByLabel("Status filter").selectOption("reviewed");
    await page.getByLabel("Search companies").fill("COST");
    await page
      .getByRole("list", { name: "Companies to review" })
      .getByRole("button", { name: /COST/ })
      .click();
    const scores = page.getByRole("list", { name: "Exposure scores" });
    await expect(scores.locator("li")).toHaveCount(1);
    await page.getByLabel("Force to add").selectOption("china");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(scores.locator("li")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Save changes as reviewed" })).toBeDisabled(); // new row needs a reason
    await page.getByRole("button", { name: "Remove China demand" }).click();
    await expect(scores.locator("li")).toHaveCount(1);
    await page.getByLabel("Strength for Consumer spending").selectOption("1");
    await page.getByRole("button", { name: "Discard changes" }).click();
    await expect(page.getByLabel("Strength for Consumer spending")).toHaveValue("3");
  });

  test("the token gate and the editor have no accessibility violations", async ({ page }) => {
    const scan = async () => {
      const r = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);
    };
    await page.goto("/review");
    await expect(page.getByLabel("Review token")).toBeVisible();
    await scan();
    await unlock(page);
    await page
      .getByRole("list", { name: "Companies to review" })
      .getByRole("button")
      .first()
      .click();
    await expect(page.getByRole("list", { name: "Exposure scores" })).toBeVisible();
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
    );
    await scan();
  });
});
