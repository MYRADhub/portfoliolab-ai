import "../e2e/env";

export const REAL_PORT = 3201;
export const REAL_DB_NAME = "pl_real";
export const REVIEW_TOKEN = "real-review-token-0123456789";

export function realDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required (set it in the repo .env)");
  const u = new URL(base);
  u.pathname = `/${REAL_DB_NAME}`;
  return u.toString();
}
