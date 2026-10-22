// Usage: tsx src/sec-cli.ts [--steps filings,fundamentals] [--tickers A,B] [--limit N] [--years 3]
// Needs SEC_USER_AGENT (who you are, for example "Your Name your@email"); the SEC requires it. DATABASE_URL picks the database.
import { parseArgs } from "node:util";
import { createDb } from "@portfolio-lab/db";
import { EdgarClient } from "./sec/edgar";
import { ingestEightKs, ingestFundamentals } from "./sec/ingest";

const { values } = parseArgs({
  options: {
    steps: { type: "string", default: "filings,fundamentals" },
    tickers: { type: "string" },
    limit: { type: "string" },
    years: { type: "string", default: "3" },
  },
});
const url = process.env.DATABASE_URL;
const ua = process.env.SEC_USER_AGENT;
if (!url) throw new Error("DATABASE_URL is required");
if (!ua) throw new Error("SEC_USER_AGENT is required, for example 'Jane Doe jane@example.edu'");

const steps = new Set(values.steps!.split(","));
const tickers = values.tickers?.split(",").map((t) => t.trim().toUpperCase());
const limit = values.limit ? Number(values.limit) : undefined;
const since = new Date(Date.now() - Number(values.years) * 365 * 86_400_000)
  .toISOString()
  .slice(0, 10);

const { db, close } = createDb(url);
const edgar = new EdgarClient(ua);
if (steps.has("filings")) {
  const s = await ingestEightKs(db, edgar, { since, tickers, limit });
  console.log(
    `8-K: ${s.companies} companies, ${s.articles} new events, ${s.skipped} filings without a mapped item, ${s.failed.length} failed`,
  );
  for (const f of s.failed.slice(0, 10)) console.error(`  ${f.ticker}: ${f.error}`);
}
if (steps.has("fundamentals")) {
  const s = await ingestFundamentals(db, edgar, { tickers, limit });
  console.log(
    `fundamentals: ${s.companies} companies, ${s.skipped} without figures, ${s.failed.length} failed`,
  );
  for (const f of s.failed.slice(0, 10)) console.error(`  ${f.ticker}: ${f.error}`);
}
await close();
