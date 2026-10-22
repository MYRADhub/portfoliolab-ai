// Usage: pnpm real
// Starts the app on http://localhost:3000 against the real-data database (pl_real). Build it first with
// `pnpm real:seed` (prices and illustrative exposures) and `pnpm data:sec` (SEC filings and fundamentals).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env and run `pnpm db:up` first.");
  process.exit(1);
}
const url = new URL(process.env.DATABASE_URL);
url.pathname = "/pl_real";

console.log(
  "Starting the app on http://localhost:3000 with real prices, SEC filings and fundamentals ...",
);
const app = spawn("pnpm", ["--filter", "@portfolio-lab/web", "exec", "next", "dev", "-p", "3000"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url.toString() },
});
app.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => app.kill(sig));
