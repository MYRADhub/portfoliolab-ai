import { defineConfig, devices } from "@playwright/test";
import { REAL_PORT, realDatabaseUrl, REVIEW_TOKEN } from "./e2e-real/env";

const baseURL = `http://127.0.0.1:${REAL_PORT}`;

/**
 * Read-only end-to-end checks against the real-data database (pl_real): real prices, SEC figures, drafted exposures.
 * Build it first with `pnpm real:seed`, `pnpm data:sec` and `pnpm data:exposures`. Nothing here writes to the database
 * and the OpenAI API is never called.
 */
export default defineConfig({
  testDir: "./e2e-real",
  testMatch: /.*\.spec\.ts/,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    {
      name: "real",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
  webServer: {
    command: `pnpm exec next start -H 127.0.0.1 -p ${REAL_PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: "production",
      DATABASE_URL: realDatabaseUrl(),
      // Tests create their own data; example portfolios in every new session would break them.
      EXAMPLE_DATA: "0",
      ANALYTICS_URL: "http://127.0.0.1:8000",
      LOG_LEVEL: "warn",
      REVIEW_TOKEN,
    },
  },
});
