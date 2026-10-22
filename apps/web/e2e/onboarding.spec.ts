import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { COVERED, startUiSession } from "./helpers";

const dialog = (page: Page) => page.getByRole("dialog");
const stored = (page: Page) =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem("pl-onboarding") ?? "{}") as Record<string, unknown>,
  );

async function openDashboard(page: Page) {
  const s = await startUiSession(page);
  await s.create("Covered", COVERED);
  await page.goto("/dashboard");
  await expect(page.getByRole("region", { name: "Key figures" })).toBeVisible();
}

test.describe("welcome card and checklist", () => {
  test("a first visit offers the tour without blocking the page, and the choice is remembered", async ({
    page,
  }) => {
    await openDashboard(page);
    const welcome = page.getByRole("region", { name: "Welcome" });
    await expect(welcome).toContainText("New here? Take a two-minute tour.");
    // not modal: the rest of the page is usable
    await page.getByRole("link", { name: "Terminal", exact: true }).first().click();
    await expect(page).toHaveURL(/\/terminal$/);
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Not now" }).click();
    await expect(welcome).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Getting started" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("region", { name: "Welcome" })).toHaveCount(0);
    expect((await stored(page)).welcomeDismissed).toBe(true);
  });

  test("the checklist ticks itself off as pages are visited and can be hidden for good", async ({
    page,
  }) => {
    await openDashboard(page);
    await page.getByRole("button", { name: "Not now" }).click();
    const progress = page.getByTestId("checklist-progress");
    await expect(progress).toHaveText("1 of 6 done"); // the dashboard itself
    const item = (name: string) =>
      page.getByRole("list", { name: "Checklist" }).getByRole("link", { name: new RegExp(name) });
    await expect(item("See your hidden exposures")).toContainText("(not yet done)");

    // Each visit is recorded after the page mounts, so wait for it before moving on.
    for (const path of ["/exposures", "/stress"]) {
      await page.goto(path);
      await expect.poll(async () => (await stored(page)).visited).toContain(path);
    }
    await page.goto("/dashboard");
    await expect(progress).toHaveText("3 of 6 done");
    await expect(item("See your hidden exposures")).toContainText("(completed)");
    await expect(item("Run a stress test")).toContainText("(completed)");
    await expect(item("Check what the news means for you")).toContainText("(not yet done)");

    await page.getByRole("button", { name: "Hide checklist" }).click();
    await expect(page.getByRole("region", { name: "Getting started" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("region", { name: "Getting started" })).toHaveCount(0);
  });

  test("progress is kept per browser, so a different visitor starts fresh", async ({
    browser,
    page,
  }) => {
    await openDashboard(page);
    await page.getByRole("button", { name: "Not now" }).click();
    const other = await browser.newContext();
    const p2 = await other.newPage();
    const s = await startUiSession(p2);
    await s.create("Covered", COVERED);
    await p2.goto("/dashboard");
    await expect(p2.getByRole("region", { name: "Welcome" })).toBeVisible();
    await other.close();
  });

  test("still works when browser storage is blocked", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("blocked");
        },
      });
    });
    await openDashboard(page);
    await page.getByRole("button", { name: "Not now" }).click();
    await expect(page.getByRole("region", { name: "Welcome" })).toHaveCount(0);
  });
});

test.describe("guided tour", () => {
  test("walks through the app, spotlights real elements and navigates between pages", async ({
    page,
  }) => {
    await openDashboard(page);
    await page.getByRole("button", { name: "Take the tour" }).click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText("Welcome to PortfolioLab");
    await expect(dialog(page)).toContainText("Step 1 of 8");
    await expect(dialog(page)).toBeFocused();

    await dialog(page).getByRole("button", { name: "Next" }).click();
    await expect(dialog(page)).toContainText("Your portfolios");
    await expect(page.locator("[data-tour-spotlight]")).toBeVisible();
    await dialog(page).getByRole("button", { name: "Next" }).click();
    await expect(dialog(page)).toContainText("The key numbers");
    await dialog(page).getByRole("button", { name: "Next" }).click();
    await expect(dialog(page)).toContainText("What to know now");

    // the spotlight sits on the element it describes
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
    );
    await expect(page.locator("[data-tour-spotlight]")).toBeVisible();
    const { spot, target } = await page.evaluate(() => {
      const r = (el: Element | null) => {
        const b = el!.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      };
      return {
        spot: r(document.querySelector("[data-tour-spotlight]")),
        target: r(document.querySelector('[data-tour="insights"]')),
      };
    });
    // the highlight frames the element with 8px of padding on every side
    expect(Math.abs(spot.x - (target.x - 8))).toBeLessThan(2);
    expect(Math.abs(spot.y - (target.y - 8))).toBeLessThan(2);
    expect(Math.abs(spot.width - (target.width + 16))).toBeLessThan(2);
    expect(Math.abs(spot.height - (target.height + 16))).toBeLessThan(2);

    await dialog(page).getByRole("button", { name: "Next" }).click(); // moves to the exposures page
    await expect(page).toHaveURL(/\/exposures$/);
    await expect(dialog(page)).toContainText("The hidden exposure map");
    await expect(page.locator("[data-tour-spotlight]")).toBeVisible();

    await dialog(page).getByRole("button", { name: "Next" }).click();
    await expect(page).toHaveURL(/\/stress$/);
    await expect(dialog(page)).toContainText("Stress Lab");
    await dialog(page).getByRole("button", { name: "Next" }).click();
    await expect(page).toHaveURL(/\/research$/);
    await expect(dialog(page)).toContainText("Ask a question");
    await dialog(page).getByRole("button", { name: "Next" }).click();
    await expect(page).toHaveURL(/\/guide$/);
    await expect(dialog(page)).toContainText("Step 8 of 8");
    await dialog(page).getByRole("button", { name: "Finish" }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect((await stored(page)).tourDone).toBe(true);
    expect(((await stored(page)).visited as string[]).includes("tour")).toBe(true);
  });

  test("keyboard: arrows move, Escape closes, focus returns to the button that opened it", async ({
    page,
  }) => {
    await openDashboard(page);
    const trigger = page.getByRole("button", { name: "Take the tour" });
    await trigger.focus();
    await trigger.click();
    await expect(dialog(page)).toContainText("Step 1 of 8");
    await page.keyboard.press("ArrowRight");
    await expect(dialog(page)).toContainText("Step 2 of 8");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await expect(dialog(page)).toContainText("Step 2 of 8");
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect((await stored(page)).tourDone).toBe(true);
  });

  test("Back is hidden on the first step, Skip closes at any step, and focus stays inside the dialog", async ({
    page,
  }) => {
    await openDashboard(page);
    await page.getByRole("button", { name: "Take the tour" }).click();
    await expect(dialog(page).getByRole("button", { name: "Back" })).toHaveCount(0);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(
        () => !!document.activeElement?.closest('[role="dialog"]'),
      );
      expect(inside).toBe(true);
    }
    await dialog(page).getByRole("button", { name: "Skip tour" }).click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test("starts from the Guide page and the checklist too, and replays after finishing", async ({
    page,
  }) => {
    await openDashboard(page);
    await page.getByRole("button", { name: "Not now" }).click();
    await page
      .getByRole("list", { name: "Checklist" })
      .getByRole("link", { name: /Take the guided tour/ })
      .click();
    await expect(dialog(page)).toContainText("Welcome to PortfolioLab");
    await page.keyboard.press("Escape");
    await page.goto("/guide");
    await page.getByRole("button", { name: "Start the guided tour" }).click();
    await expect(dialog(page)).toContainText("Step 1 of 8");
  });

  for (const theme of ["light", "dark"]) {
    test(`the tour dialog has no accessibility violations in ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("pl-theme", t), theme);
      await openDashboard(page);
      await page.getByRole("button", { name: "Take the tour" }).click();
      await dialog(page).getByRole("button", { name: "Next" }).click();
      await expect(page.locator("[data-tour-spotlight]")).toBeVisible();
      await page.evaluate(() =>
        Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
      );
      const r = await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);
    });
  }
});

test.describe("on a phone-sized screen", () => {
  test.use({ viewport: { width: 390, height: 800 } });
  test("the tour popover fits inside the screen", async ({ page }) => {
    await openDashboard(page);
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("button", { name: "Take the tour" }).click();
    await expect(dialog(page)).toBeVisible();
    const box = await dialog(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.y + box!.height).toBeLessThanOrEqual(800);
  });
});
