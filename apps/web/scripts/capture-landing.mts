// Usage: pnpm --filter @portfolio-lab/web exec tsx scripts/capture-landing.mts [--base http://localhost:3000]
//        [--session <session cookie value> --thread <research thread id>]   reuse an earlier conversation and its deck
// Captures the landing page's screenshots from a running app on the real data (start it with `pnpm real`), in light
// and dark, into public/landing. It asks the research assistant one real question, so it needs the OpenAI key and
// costs a few AI calls.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, type Page } from "@playwright/test";

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3000" },
    session: { type: "string" },
    thread: { type: "string" },
  },
});
const base = values.base!;
const out = fileURLToPath(new URL("../public/landing/", import.meta.url));
mkdirSync(out, { recursive: true });

const QUESTION =
  "Compare NVIDIA and AMD over the last year, and how would adding AMD at 5% change my portfolio's risk?";

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  baseURL: base,
});
const page = await context.newPage();
page.setDefaultTimeout(60_000);

async function settle(p: Page) {
  await p.waitForLoadState("networkidle");
  // The development server's badge would sit on top of the sidebar.
  await p.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await p.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  await p.waitForTimeout(400);
}

async function shoot(p: Page, name: string, theme: "light" | "dark") {
  // Park the pointer over the sidebar so no chart tooltip shows.
  await p.mouse.move(20, 880);
  await settle(p);
  await p.screenshot({ path: `${out}${name}-${theme}.jpg`, type: "jpeg", quality: 82 });
  console.log(`saved ${name}-${theme}.jpg`);
}

async function setTheme(p: Page, theme: "light" | "dark") {
  await p.evaluate((t) => localStorage.setItem("pl-theme", t), theme);
}

// One session for every shot, so the research thread made in the first pass can be shown in the second.
if (values.session) {
  await context.addCookies([{ name: "pl_session", value: values.session, url: base }]);
}
await page.goto("/dashboard");
await page
  .getByRole("region", { name: "Key figures" })
  .getByText("Ups and downs", { exact: true })
  .waitFor();
// First-visit prompts would take the top of the dashboard; dismissing them is remembered for the session.
for (const name of ["Not now", "Hide checklist"]) {
  const b = page.getByRole("button", { name });
  if (await b.isVisible()) await b.click();
}

let threadId = values.thread;
if (!threadId) {
  await page.goto("/research");
  await page.getByLabel("Your question").fill(QUESTION);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const deckLink = page.getByRole("link", { name: "Presentation", exact: true });
  await deckLink.waitFor({ timeout: 300_000 });
  const href = (await deckLink.getAttribute("href")) ?? "";
  threadId = /\/research\/c\/([0-9a-f-]+)\/deck/.exec(href)?.[1];
  if (!threadId) throw new Error(`no thread id in the presentation link "${href}"`);

  await page.goto(`/research/c/${threadId}/deck`);
  await page.getByRole("button", { name: "Prepare presentation" }).click();
  await page.getByRole("button", { name: "Prepare presentation" }).waitFor({
    state: "detached",
    timeout: 300_000,
  });
}
const cookie = (await context.cookies()).find((c) => c.name === "pl_session");
console.log(`session ${cookie?.value} thread ${threadId}`);

for (const theme of ["light", "dark"] as const) {
  await setTheme(page, theme);

  await page.goto("/dashboard");
  await page
    .getByRole("region", { name: "Key figures" })
    .getByText("Ups and downs", { exact: true })
    .waitFor();
  await shoot(page, "dashboard", theme);

  await page.goto("/news");
  await page.getByRole("button", { name: "How we judged this" }).first().click();
  await page
    .getByRole("region", { name: "How we judged this story" })
    .getByText("Coverage")
    .waitFor();
  await page
    .getByRole("region", { name: "How we judged this story" })
    .evaluate((el) => el.closest("article")?.scrollIntoView({ block: "start" }));
  await shoot(page, "news", theme);

  await page.goto(`/research?thread=${threadId}`);
  const answer = page.getByRole("region", { name: "Assistant answer" }).first();
  await answer.waitFor();
  await page
    .getByText(QUESTION)
    .first()
    .evaluate((el) => el.scrollIntoView({ block: "start" }));
  await shoot(page, "research", theme);

  await page.goto("/research/AMD");
  await page
    .getByRole("region", { name: "Portfolio fit" })
    .getByRole("region", { name: /Portfolio with and without AMD/ })
    .waitFor();
  const fit = page.getByRole("region", { name: "Portfolio fit" });
  await fit.getByText("Correlations, scenarios and exposures").click();
  await fit.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await shoot(page, "fit", theme);

  await page.goto(`/research/c/${threadId}/deck`);
  await page.getByRole("button", { name: "Present", exact: true }).waitFor();
  // The third slide carries a chart; the title slide is mostly empty space.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await shoot(page, "deck", theme);
}

await browser.close();
