import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOCK_PORT, WEB_PORT } from "./env";

export const BASE = `http://127.0.0.1:${WEB_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;

export type MockMode = "grounded" | "ungrounded" | "retry" | "error" | "refusal" | "incomplete";

export const mock = {
  async setMode(mode: MockMode) {
    const r = await fetch(`${MOCK}/__mode`, { method: "POST", body: JSON.stringify({ mode }) });
    expect(r.ok).toBe(true);
  },
  async reset() {
    await fetch(`${MOCK}/__reset`, { method: "POST" });
  },
  async requests(): Promise<
    { auth?: string; model: string; instructions: string; input: string; mode: string }[]
  > {
    return (await fetch(`${MOCK}/__requests`)).json() as Promise<never>;
  },
};

export type Holding = { ticker: string; weightPct: number };

export const EXAMPLE: Holding[] = [
  { ticker: "NVDA", weightPct: 25 },
  { ticker: "AAPL", weightPct: 20 },
  { ticker: "MSFT", weightPct: 20 },
  { ticker: "AMZN", weightPct: 15 },
  { ticker: "JPM", weightPct: 20 },
];

/** Holdings covered by the e2e exposure fixtures. */
export const COVERED: Holding[] = [
  { ticker: "NVDA", weightPct: 40 },
  { ticker: "AAPL", weightPct: 30 },
  { ticker: "MSFT", weightPct: 20 },
  { ticker: "AMZN", weightPct: 10 },
];

const COUNTER_FILE = resolve(__dirname, ".counter");

/** A number never handed out before in this run, shared across spec files (setup resets it). Tests run one at a time. */
function nextUnique(): number {
  let n = 0;
  try {
    n = Number(readFileSync(COUNTER_FILE, "utf8")) || 0;
  } catch {
    n = 0;
  }
  writeFileSync(COUNTER_FILE, String(n + 1));
  return n;
}

/**
 * Two weights summing to 100 whose largest-holding fact text ("NVDA 54.3%") has not been used before in this
 * run. Explanations are cached by their fact text, so nearby weights that round the same would collide.
 */
export function uniqueHoldings(): Holding[] {
  const n = nextUnique();
  if (n >= 400) throw new Error("ran out of unique weights; run the e2e setup again");
  const first = (520 + n) / 10; // 52.0 to 91.9, so NVDA is always the larger weight
  return [
    { ticker: "NVDA", weightPct: first },
    { ticker: "AAPL", weightPct: Math.round((100 - first) * 10) / 10 },
  ];
}

type PlaywrightLike = {
  request: { newContext(options: { baseURL: string }): Promise<APIRequestContext> };
};

export async function newSession(playwright: PlaywrightLike): Promise<APIRequestContext> {
  const ctx = await playwright.request.newContext({ baseURL: BASE });
  const r = await ctx.post("/api/session");
  expect(r.status()).toBe(200);
  return ctx;
}

export async function createPortfolio(
  ctx: APIRequestContext,
  name: string,
  holdings: Holding[],
): Promise<string> {
  const r = await ctx.post("/api/portfolios", { data: { name, holdings } });
  expect(r.status(), await r.text()).toBe(201);
  return ((await r.json()) as { portfolio: { id: string } }).portfolio.id;
}

/** Loads the app so the session cookie exists, then returns a way to create portfolios as that same browser session. */
export async function startUiSession(page: Page) {
  await page.goto("/dashboard");
  await expect
    .poll(async () => (await page.context().cookies()).some((c) => c.name === "pl_session"))
    .toBe(true);
  return {
    async create(name: string, holdings: Holding[]): Promise<string> {
      const r = await page.request.post("/api/portfolios", { data: { name, holdings } });
      expect(r.status(), await r.text()).toBe(201);
      return ((await r.json()) as { portfolio: { id: string } }).portfolio.id;
    },
  };
}

export async function waitForDashboard(page: Page) {
  await expect(page.getByText("Sharpe", { exact: true })).toBeVisible();
}

export const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

/** The app's own alert messages, excluding Next.js's hidden route announcer, which also has role="alert". */
export const appAlert = (page: Page) =>
  page.locator('[role="alert"]:not(#__next-route-announcer__)');

/** The known past trading day that has seeded news for NVDA (see setup-db.ts). */
const fixtures = JSON.parse(readFileSync(resolve(__dirname, ".fixtures.json"), "utf8")) as {
  newsDate: string;
  quietDate: string;
};
export const NEWS_DATE: string = fixtures.newsDate;
/** A trading day with no seeded news at all. */
export const QUIET_DATE: string = fixtures.quietDate;
export const NEWS_TITLE = "E2E Acme cuts outlook on weak orders";

/** The dashboard's holdings card, so row counts are not confused by the other tables on the page. */
export const holdingsCard = (page: Page) =>
  page.getByText("Holdings (effective").locator("xpath=ancestor::*[@data-slot='card'][1]");
/** The "Why did my portfolio move?" card. */
export const moveCard = (page: Page) =>
  page.getByText("Why did my portfolio move?").locator("xpath=ancestor::*[@data-slot='card'][1]");
