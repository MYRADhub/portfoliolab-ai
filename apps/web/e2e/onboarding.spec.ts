import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { COVERED } from "./helpers";

// These tests are about the tour opening by itself, so they start without the opt-out the other specs use.
test.use({ storageState: { cookies: [], origins: [] } });

const STEPS = 9;
const dialog = (page: Page) => page.getByRole("dialog");
const stored = (page: Page) =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem("pl-onboarding") ?? "{}") as Record<string, unknown>,
  );

/**
 * A session with a covered portfolio, set up from the Guide so the visit's first dashboard is still to come.
 * Returns once the dashboard is open (and with it, unless opted out, the tour).
 */
async function firstDashboard(page: Page) {
  await page.goto("/guide");
  await expect
    .poll(async () => (await page.context().cookies()).some((c) => c.name === "pl_session"))
    .toBe(true);
  const r = await page.request.post("/api/portfolios", {
    data: { name: "Covered", holdings: COVERED },
  });
  expect(r.status()).toBe(201);
  await page.goto("/dashboard");
  await expect(page.getByRole("region", { name: "Key figures" })).toBeVisible();
}

/** A new tab in the same browser: the same visitor, but a new visit. */
async function newVisit(context: BrowserContext) {
  const tab = await context.newPage();
  await tab.goto("/dashboard");
  await expect(tab.getByRole("region", { name: "Key figures" })).toBeVisible();
  return tab;
}

test.describe("the tour opens by itself", () => {
  test("on the first dashboard of each visit, once, and Skip ends it for that visit", async ({
    page,
    context,
  }) => {
    await firstDashboard(page);
    await expect(dialog(page)).toContainText("Welcome to PortfolioLab");
    await expect(dialog(page)).toContainText(`Step 1 of ${STEPS}`);
    await expect(dialog(page).getByRole("checkbox")).not.toBeChecked();

    await dialog(page).getByRole("button", { name: "Skip tour" }).click();
    await expect(dialog(page)).toHaveCount(0);
    // Same visit: moving around or reloading does not bring it back.
    await page.goto("/news");
    await page.goto("/dashboard");
    await page.reload();
    await expect(page.getByRole("region", { name: "Key figures" })).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);

    // A new visit (a new tab) starts it again.
    const tab = await newVisit(context);
    await expect(dialog(tab)).toContainText("Welcome to PortfolioLab");
  });

  test("not when a visit starts on another page, until that visit reaches the dashboard", async ({
    page,
  }) => {
    await page.goto("/news");
    await expect(page.getByRole("heading", { name: "News", level: 1 })).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Dashboard" })
      .click();
    await expect(dialog(page)).toContainText("Welcome to PortfolioLab");
  });

  test("'Don't start this tour automatically' is remembered, and the Tutorial button still works", async ({
    page,
    context,
  }) => {
    await firstDashboard(page);
    await dialog(page)
      .getByRole("checkbox", { name: /start this tour automatically/ })
      .check();
    expect((await stored(page)).tourOptOut).toBe(true);
    await page.keyboard.press("Escape");

    const tab = await newVisit(context);
    await expect(dialog(tab)).toHaveCount(0);
    await tab.getByRole("button", { name: "Tutorial", exact: true }).click();
    await expect(dialog(tab)).toContainText(`Step 1 of ${STEPS}`);
    await expect(dialog(tab).getByRole("checkbox")).toBeChecked();
    // Turning it back on brings the automatic start back for the next visit.
    await dialog(tab).getByRole("checkbox").uncheck();
    await page.keyboard.press("Escape");
    const again = await newVisit(context);
    await expect(dialog(again)).toContainText("Welcome to PortfolioLab");
  });

  test("still opens once, and can be skipped, when browser storage is blocked", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      for (const name of ["localStorage", "sessionStorage"])
        Object.defineProperty(window, name, {
          get() {
            throw new Error("blocked");
          },
        });
    });
    await firstDashboard(page);
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole("button", { name: "Skip tour" }).click();
    await expect(dialog(page)).toHaveCount(0);
  });
});

test.describe("guided tour", () => {
  test("walks through the app, spotlighting the real controls on each page, with something to try", async ({
    page,
  }) => {
    await firstDashboard(page);
    await expect(dialog(page)).toBeFocused();
    const next = () => dialog(page).getByRole("button", { name: "Next" }).click();
    const spot = page.locator("[data-tour-spotlight]");

    await next();
    await expect(dialog(page)).toContainText("Your portfolios");
    await expect(dialog(page)).toContainText("Try it:");
    await expect(spot).toBeVisible();
    await next();
    await expect(dialog(page)).toContainText("How you are doing, in plain words");

    // The spotlight frames the element it describes, with 8px of padding on every side.
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
    );
    await expect(spot).toBeVisible();
    const { s, t } = await page.evaluate(() => {
      const r = (el: Element | null) => {
        const b = el!.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      };
      return {
        s: r(document.querySelector("[data-tour-spotlight]")),
        t: r(document.querySelector('[data-tour="summary"]')),
      };
    });
    expect(Math.abs(s.x - (t.x - 8))).toBeLessThan(2);
    expect(Math.abs(s.y - (t.y - 8))).toBeLessThan(2);
    expect(Math.abs(s.width - (t.width + 16))).toBeLessThan(2);
    expect(Math.abs(s.height - (t.height + 16))).toBeLessThan(2);

    await next();
    await expect(dialog(page)).toContainText("What to know now");

    for (const [url, title, hint] of [
      [/\/news$/, "News ranked for your holdings", "How we judged this"],
      [/\/research$/, "Ask the research assistant", "How would AMD fit my portfolio?"],
      [/\/research\/AMD$/, "Test a company before you add it", null],
      [/\/dashboard$/, "More analysis tools", null],
      [/\/guide$/, "Help is always here", null],
    ] as const) {
      await next();
      await expect(page).toHaveURL(url);
      await expect(dialog(page)).toContainText(title);
      if (hint) await expect(dialog(page)).toContainText(hint);
      await expect(spot).toBeVisible();
      // The popover stays on screen even when the spotlighted element is tall.
      const box = (await dialog(page).boundingBox())!;
      const vp = page.viewportSize()!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    }
    await expect(dialog(page)).toContainText(`Step ${STEPS} of ${STEPS}`);
    await expect(dialog(page).getByRole("button", { name: "Skip tour" })).toHaveCount(0);
    await dialog(page).getByRole("button", { name: "Finish" }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect((await stored(page)).tourDone).toBe(true);
    expect(((await stored(page)).visited as string[]).includes("tour")).toBe(true);
  });

  test("keyboard: arrows move, Escape closes, focus returns to the button that opened it", async ({
    page,
  }) => {
    await firstDashboard(page);
    await page.keyboard.press("Escape");
    const trigger = page.getByRole("button", { name: "Tutorial", exact: true });
    await trigger.focus();
    await trigger.click();
    await expect(dialog(page)).toContainText(`Step 1 of ${STEPS}`);
    await page.keyboard.press("ArrowRight");
    await expect(dialog(page)).toContainText(`Step 2 of ${STEPS}`);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await expect(dialog(page)).toContainText(`Step 2 of ${STEPS}`);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect((await stored(page)).tourDone).toBe(true);
  });

  test("Back is hidden on the first step, both close buttons work, and focus stays inside the dialog", async ({
    page,
  }) => {
    await firstDashboard(page);
    await expect(dialog(page).getByRole("button", { name: "Back" })).toHaveCount(0);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(
        () => !!document.activeElement?.closest('[role="dialog"]'),
      );
      expect(inside).toBe(true);
    }
    await dialog(page).getByRole("button", { name: "Close tour" }).click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test("starts from the Guide page and the checklist too", async ({ page }) => {
    await firstDashboard(page);
    await page.keyboard.press("Escape");
    await page
      .getByRole("list", { name: "Checklist" })
      .getByRole("link", { name: /Take the guided tour/ })
      .click();
    await expect(dialog(page)).toContainText("Welcome to PortfolioLab");
    await page.keyboard.press("Escape");
    await page.goto("/guide");
    await page.getByRole("button", { name: "Start the guided tour" }).click();
    await expect(dialog(page)).toContainText(`Step 1 of ${STEPS}`);
  });

  for (const theme of ["light", "dark"]) {
    test(`the tour dialog has no accessibility violations in ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("pl-theme", t), theme);
      await firstDashboard(page);
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

test.describe("getting-started checklist", () => {
  test("ticks itself off as pages are visited and can be hidden for good", async ({ page }) => {
    await firstDashboard(page);
    await page.keyboard.press("Escape");
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
    await page.getByRole("button", { name: "Hide checklist" }).click();
    await expect(page.getByRole("region", { name: "Getting started" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("region", { name: "Getting started" })).toHaveCount(0);
  });
});

test.describe("on a phone-sized screen", () => {
  test.use({ viewport: { width: 390, height: 800 } });
  test("the tour popover fits inside the screen and its steps can be followed", async ({
    page,
  }) => {
    await firstDashboard(page);
    await expect(dialog(page)).toBeVisible();
    for (let i = 0; i < 3; i++) {
      const box = (await dialog(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      expect(box.y + box.height).toBeLessThanOrEqual(800);
      await dialog(page).getByRole("button", { name: "Next" }).click();
    }
  });
});
