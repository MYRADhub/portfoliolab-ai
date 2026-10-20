// Usage: tsx src/news-cli.ts --provider finnhub|marketaux [--tickers NVDA,AAPL] [--days 7] [--delay-ms 1000]
// Without --tickers, ingests news for every ticker held in any portfolio.
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { companies, createDb, holdings } from "@portfolio-lab/db";
import { FinnhubNewsProvider } from "./news/finnhub";
import { MarketauxNewsProvider } from "./news/marketaux";
import { ingestNews } from "./news/ingest";
import type { NewsProvider } from "./news/types";

const { values } = parseArgs({
  options: {
    provider: { type: "string" },
    tickers: { type: "string" },
    days: { type: "string", default: "7" },
    "delay-ms": { type: "string", default: "0" },
  },
});

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

let provider: NewsProvider;
if (values.provider === "finnhub") {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY is required for --provider finnhub");
  provider = new FinnhubNewsProvider(key);
} else if (values.provider === "marketaux") {
  const key = process.env.MARKETAUX_API_KEY;
  if (!key) throw new Error("MARKETAUX_API_KEY is required for --provider marketaux");
  provider = new MarketauxNewsProvider(key);
} else {
  throw new Error("--provider must be finnhub or marketaux");
}

const { db, close } = createDb(url);
const tickers = values.tickers
  ? values.tickers.split(",").map((t) => t.trim().toUpperCase())
  : [
      ...new Set(
        (
          await db
            .select({ t: companies.ticker })
            .from(holdings)
            .innerJoin(companies, eq(companies.id, holdings.companyId))
        ).map((r) => r.t),
      ),
    ];

const now = new Date();
const from = new Date(now.getTime() - Number(values.days) * 86_400_000);
const summary = await ingestNews(
  db,
  provider,
  tickers,
  { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) },
  { delayMs: Number(values["delay-ms"]) },
);
await close();

console.log(JSON.stringify({ ...summary, tickers: tickers.length }, null, 2));
if (summary.stoppedEarly)
  console.error(`stopped early: ${summary.stoppedEarly}; rerun later to continue`);
if (summary.failures.length || summary.stoppedEarly) process.exit(1);
