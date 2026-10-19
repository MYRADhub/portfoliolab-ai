// Usage: tsx src/cli.ts --provider fixture|tiingo [--tickers NVDA,AAPL] [--years 5] [--limit N] [--delay-ms N]
import { parseArgs } from "node:util";
import { createDb } from "@portfolio-lab/db";
import { FixtureProvider } from "./providers/fixture";
import { TiingoProvider } from "./providers/tiingo";
import { runUpdate } from "./ingest";
import type { PriceProvider } from "./providers/types";

const { values } = parseArgs({
  options: {
    provider: { type: "string", default: "fixture" },
    tickers: { type: "string" },
    years: { type: "string", default: "5" },
    limit: { type: "string" },
    "delay-ms": { type: "string", default: "0" },
  },
});

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

let provider: PriceProvider;
if (values.provider === "fixture") {
  provider = new FixtureProvider();
} else if (values.provider === "tiingo") {
  const key = process.env.TIINGO_API_KEY;
  if (!key) throw new Error("TIINGO_API_KEY is required for --provider tiingo");
  provider = new TiingoProvider(key);
} else {
  throw new Error(`unknown provider ${values.provider}`);
}

const { db, close } = createDb(url);

const now = new Date();
const from = new Date(now);
from.setUTCFullYear(from.getUTCFullYear() - Number(values.years));
const summary = await runUpdate(db, provider, {
  backfillFrom: from.toISOString().slice(0, 10),
  to: now.toISOString().slice(0, 10),
  limit: values.limit ? Number(values.limit) : undefined,
  tickers: values.tickers?.split(",").map((t) => t.trim().toUpperCase()),
  delayMs: Number(values["delay-ms"]),
});
await close();

for (const r of summary.ok) console.log(`${r.ticker}: inserted ${r.inserted} (${r.from}..${r.to})`);
for (const f of summary.failed) console.error(`${f.ticker}: FAILED ${f.error}`);
console.log(
  `ok ${summary.ok.length}, failed ${summary.failed.length}, remaining ${summary.remaining.length}`,
);
if (summary.stoppedEarly)
  console.error(`stopped early: ${summary.stoppedEarly}; rerun later to continue`);
if (summary.failed.length || summary.stoppedEarly) process.exit(1);
