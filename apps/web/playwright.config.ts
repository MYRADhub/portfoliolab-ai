import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrl, EXPERIMENT_TOKEN, MOCK_PORT, REVIEW_TOKEN, WEB_PORT } from "./e2e/env";

const baseURL = `http://127.0.0.1:${WEB_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  // The mock OpenAI server holds a single global mode, so tests run one at a time.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    {
      name: "desktop",
      testIgnore: /mobile\.spec/,
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: "mobile",
      testMatch: /mobile\.spec/,
      use: { ...devices["Pixel 7"], channel: "chrome" },
    },
  ],
  webServer: [
    {
      command: "pnpm exec tsx e2e/mock-openai.ts",
      url: `http://127.0.0.1:${MOCK_PORT}/__health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `pnpm exec next start -H 127.0.0.1 -p ${WEB_PORT}`,
      url: `${baseURL}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: "production",
        DATABASE_URL: e2eDatabaseUrl(),
        // Tests create their own data; example portfolios in every new session would break them.
        EXAMPLE_DATA: "0",
        ANALYTICS_URL: "http://127.0.0.1:8000",
        OPENAI_API_KEY: "test-key",
        OPENAI_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
        LOG_LEVEL: "warn",
        EXPERIMENT_ENABLED: "1",
        EXPERIMENT_ADMIN_TOKEN: EXPERIMENT_TOKEN,
        STUDY_RESEARCHER: "E2E Researcher, Test School",
        STUDY_APPROVAL: "Test approver, 2026-10-01",
        STUDY_CONTACT: "study@example.org",
        STUDY_RETENTION: "Until the end of the test run, then deleted.",
        STUDY_END: "2026-12-31",
        STUDY_ALLOW_MINORS: "1",
        REVIEW_TOKEN,
      },
    },
  ],
});
