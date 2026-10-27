// Usage: tsx src/real-cli.ts [--db pl_real] [--steps prices,benchmark,proxies,exposures] [--years 5] [--limit N] [--tickers A,B]
// Builds a database of REAL data next to the dev database: S&P 500 companies and daily prices from Yahoo Finance.
// Every step can be repeated; prices resume where they stopped. Exposures are the illustrative demo exposures.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { seedEventTypes } from "@portfolio-lab/classify";
import { createDb } from "@portfolio-lab/db";
import { PROXY_SYMBOLS } from "@portfolio-lab/shared";
import {
  ingestBenchmark,
  loadConstituents,
  runUpdate,
  YahooProvider,
  type Constituent,
} from "@portfolio-lab/data";
import { seedDemoExposures } from "./seed";

const { values } = parseArgs({
  options: {
    db: { type: "string", default: "pl_real" },
    steps: { type: "string", default: "prices,benchmark,proxies,exposures" },
    years: { type: "string", default: "5" },
    limit: { type: "string" },
    tickers: { type: "string" },
    "delay-ms": { type: "string", default: "250" },
  },
});
const base = process.env.DATABASE_URL;
if (!base) throw new Error("DATABASE_URL is required");
const name = values.db!;
if (!/^[a-z0-9_]+$/.test(name))
  throw new Error("database name may only use lowercase letters, digits and underscores");
const steps = new Set(values.steps!.split(","));

async function main() {
  const admin = postgres(base!, { max: 1, onnotice: () => undefined });
  const exists = await admin`select 1 from pg_database where datname = ${name}`;
  if (exists.length === 0) await admin.unsafe(`create database ${name}`);
  await admin.end();

  const url = new URL(base!);
  url.pathname = `/${name}`;
  const { db, close } = createDb(url.toString());
  const root = fileURLToPath(new URL("../../..", import.meta.url)).replace(/\/$/, "");
  await migrate(db, { migrationsFolder: `${root}/packages/db/migrations` });

  const dir = `${root}/packages/data/snapshots/`;
  const file = readdirSync(dir)
    .filter((f) => f.startsWith("sp500-"))
    .sort()
    .at(-1)!;
  await loadConstituents(db, JSON.parse(readFileSync(`${dir}${file}`, "utf8")) as Constituent[]);
  // SEC filings are stored under these event types; a filing whose type is missing would be dropped.
  await seedEventTypes(db);

  if (steps.has("prices")) {
    const now = new Date();
    const from = new Date(now);
    from.setUTCFullYear(from.getUTCFullYear() - Number(values.years));
    const summary = await runUpdate(db, new YahooProvider(), {
      backfillFrom: from.toISOString().slice(0, 10),
      to: now.toISOString().slice(0, 10),
      limit: values.limit ? Number(values.limit) : undefined,
      tickers: values.tickers?.split(",").map((t) => t.trim().toUpperCase()),
      delayMs: Number(values["delay-ms"]),
    });
    console.log(
      `prices: ok ${summary.ok.length}, failed ${summary.failed.length}, remaining ${summary.remaining.length}`,
    );
    for (const f of summary.failed.slice(0, 20)) console.error(`  ${f.ticker}: ${f.error}`);
    if (summary.stoppedEarly)
      console.error(`stopped early: ${summary.stoppedEarly}; rerun to continue`);
  }
  if (steps.has("benchmark")) {
    const now = new Date();
    const from = new Date(now);
    from.setUTCFullYear(from.getUTCFullYear() - Number(values.years));
    const r = await ingestBenchmark(db, new YahooProvider(), "SPY", {
      backfillFrom: from.toISOString().slice(0, 10),
      to: now.toISOString().slice(0, 10),
    });
    console.log(`benchmark: ${r.symbol} ${r.inserted} new days`);
  }
  if (steps.has("proxies")) {
    // Funds that track each force, used to check the exposure scores against prices.
    const now = new Date();
    const from = new Date(now);
    from.setUTCFullYear(from.getUTCFullYear() - Number(values.years));
    for (const symbol of PROXY_SYMBOLS) {
      const r = await ingestBenchmark(db, new YahooProvider(), symbol, {
        backfillFrom: from.toISOString().slice(0, 10),
        to: now.toISOString().slice(0, 10),
      });
      console.log(`proxy: ${r.symbol} ${r.inserted} new days`);
    }
  }
  if (steps.has("exposures")) console.log("exposures:", await seedDemoExposures(db));

  await close();
  console.log(`real-data database "${name}" ready`);
  console.log(`DATABASE_URL=${url.toString()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
