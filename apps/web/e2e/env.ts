import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = `${resolve(__dirname, "../../..")}/`;
if (existsSync(`${root}.env`)) process.loadEnvFile(`${root}.env`);

export const WEB_PORT = 3200;
export const MOCK_PORT = 3299;
export const EXPERIMENT_TOKEN = "e2e-admin-token-0123456789";
export const REVIEW_TOKEN = "e2e-review-token-0123456789";
export const E2E_DB_NAME = "pl_e2e";

/** The e2e database lives on the same server as the dev database but under its own name. */
export function e2eDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required (set it in the repo .env)");
  const u = new URL(base);
  u.pathname = `/${E2E_DB_NAME}`;
  return u.toString();
}

export function adminDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required");
  return base;
}

export const REPO_ROOT = root;
