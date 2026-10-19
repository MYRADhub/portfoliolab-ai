// Usage: tsx src/cli.ts --provider fixture|tiingo [--tickers NVDA,AAPL] [--years 5]
import { parseArgs } from "node:util";
import { createDb, companies } from "@portfolio-lab/db";
import { FixtureProvider } from "./providers/fixture";
import { TiingoProvider } from "./providers/tiingo";
import { ingestPrices } from "./ingest";
import type { PriceProvider } from "./providers/types";

const { values } = parseArgs({
  options: {
    provider: { type: "string", default: "fixture" },
    tickers: { type: "string" },
    years: { type: "string", default: "5" },
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
const tickers = values.tickers
  ? values.tickers.split(",").map((t) => t.trim().toUpperCase())
  : (await db.select({ t: companies.ticker }).from(companies)).map((r) => r.t);

const now = new Date();
const from = new Date(now);
from.setUTCFullYear(from.getUTCFullYear() - Number(values.years));
const range = { backfillFrom: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };

let failures = 0;
for (const ticker of tickers) {
  try {
    const r = await ingestPrices(db, provider, ticker, range);
    console.log(`${ticker}: inserted ${r.inserted} (${r.from}..${r.to})`);
  } catch (err) {
    failures++;
    console.error(`${ticker}: FAILED ${err instanceof Error ? err.message : err}`);
  }
}
await close();
if (failures) process.exit(1);
