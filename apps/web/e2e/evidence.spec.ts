import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test.describe("evidence page", () => {
  test("states each claim with a verdict, and says when the data cannot test it", async ({
    page,
  }) => {
    const r = await page.request.get("/api/evidence");
    expect(r.status()).toBe(200);
    const b = (await r.json()) as Json;
    expect(b.findings.map((f: Json) => f.id)).toEqual([
      "spillover",
      "sectors",
      "earnings",
      "drafts",
    ]);
    for (const f of b.findings) {
      expect(["supported", "not_supported", "inconclusive", "no_data"]).toContain(f.verdict);
      expect(f.question.length).toBeGreaterThan(10);
      expect(f.result.length).toBeGreaterThan(10);
      expect(f.href).toMatch(/^\//);
    }
    // the fixture database is far too small for the first two tests
    expect(b.findings[0].verdict).toBe("no_data");
    expect(b.findings[1].verdict).toBe("no_data");
    // and no gold-set company has enough blind scores yet
    expect(b.findings[3].verdict).toBe("no_data");
    expect(b.findings[3].href).toBe("/api/evidence/agreement");
  });

  test("the page lists the findings, each with its link, and has no accessibility violations", async ({
    page,
  }) => {
    await page.goto("/evidence");
    await expect(page.getByRole("heading", { name: "Evidence", level: 1 })).toBeVisible();
    const list = page.getByRole("list", { name: "Findings" });
    await expect(list.locator("> li")).toHaveCount(4);
    await expect(page.getByTestId("verdict-spillover")).toHaveText("Not enough data");
    await expect(list.getByRole("link", { name: "See the full test" })).toHaveCount(3);
    await expect(list.getByRole("link", { name: "Download the scores (CSV)" })).toHaveAttribute(
      "href",
      "/api/evidence/agreement",
    );
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
    );
    const r = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(r.violations).toEqual([]);
  });
});
