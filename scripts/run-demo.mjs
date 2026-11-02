// Usage: pnpm demo
// Builds (or refreshes) the demo database, then starts the app on http://localhost:3000 in demo mode.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env and run `pnpm db:up` first.");
  process.exit(1);
}

const url = new URL(process.env.DATABASE_URL);
url.pathname = "/pl_demo";
const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL, NEXT_PUBLIC_DEMO_MODE: "1" };

console.log("Preparing the demo database (safe to repeat)...");
const seed = spawnSync("pnpm", ["demo:seed"], { stdio: "inherit", env });
if (seed.status !== 0) process.exit(seed.status ?? 1);

console.log("Starting the app in demo mode on http://localhost:3000 ...");
const app = spawn("pnpm", ["--filter", "@portfolio-lab/web", "exec", "next", "dev", "-p", "3000"], {
  stdio: "inherit",
  env: { ...env, DATABASE_URL: url.toString() },
});
app.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => app.kill(sig));
