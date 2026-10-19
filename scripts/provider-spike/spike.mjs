// Probes free-tier data providers and prints coverage, timestamp shape, and rate-limit headers.
// Usage: node --env-file=.env scripts/provider-spike/spike.mjs
import { mkdir, writeFile } from "node:fs/promises";

const tickers = ["NVDA", "AAPL", "MSFT", "AMZN", "JPM"];
const out = new URL("./out/", import.meta.url);
await mkdir(out, { recursive: true });

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => new Date(today.getTime() - n * 86_400_000);

async function probe(name, url, headers = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers });
    const body = await res.text();
    const limits = Object.fromEntries(
      [...res.headers].filter(([k]) => /ratelimit|rate-limit|retry-after|x-.*-limit/i.test(k)),
    );
    await writeFile(new URL(`${name}.json`, out), body);
    return { name, status: res.status, ms: Date.now() - started, bytes: body.length, limits, body };
  } catch (err) {
    return { name, error: String(err) };
  }
}

const results = [];
const key = (k) => process.env[k];

if (key("TIINGO_API_KEY")) {
  for (const t of tickers.slice(0, 2)) {
    const r = await probe(
      `tiingo-prices-${t}`,
      `https://api.tiingo.com/tiingo/daily/${t}/prices?startDate=${iso(daysAgo(730))}&endDate=${iso(today)}&token=${key("TIINGO_API_KEY")}`,
    );
    const rows = r.body ? JSON.parse(r.body) : [];
    r.summary = {
      rows: rows.length,
      first: rows[0]?.date,
      hasAdjClose: rows[0]?.adjClose !== undefined,
    };
    results.push(r);
  }
}

if (key("FINNHUB_API_KEY")) {
  for (const t of tickers) {
    const r = await probe(
      `finnhub-news-${t}`,
      `https://finnhub.io/api/v1/company-news?symbol=${t}&from=${iso(daysAgo(7))}&to=${iso(today)}&token=${key("FINNHUB_API_KEY")}`,
    );
    const rows = r.body ? JSON.parse(r.body) : [];
    r.summary = {
      articles: Array.isArray(rows) ? rows.length : 0,
      hasUnixTimestamp: Array.isArray(rows) && typeof rows[0]?.datetime === "number",
      hasBody: Array.isArray(rows) && Boolean(rows[0]?.summary),
    };
    results.push(r);
  }
}

if (key("MARKETAUX_API_KEY")) {
  const r = await probe(
    "marketaux-news",
    `https://api.marketaux.com/v1/news/all?symbols=${tickers.join(",")}&filter_entities=true&language=en&api_token=${key("MARKETAUX_API_KEY")}`,
  );
  const parsed = r.body ? JSON.parse(r.body) : {};
  r.summary = { articles: parsed.data?.length ?? 0, meta: parsed.meta };
  results.push(r);
}

if (key("ALPHAVANTAGE_API_KEY")) {
  const r = await probe(
    "alphavantage-daily-adjusted",
    `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=NVDA&outputsize=compact&apikey=${key("ALPHAVANTAGE_API_KEY")}`,
  );
  r.summary = { note: r.body?.slice(0, 160) };
  results.push(r);
}

if (results.length === 0) {
  console.error("No provider keys set. Copy .env.example to .env and fill in keys.");
  process.exit(1);
}

for (const r of results) {
  const printable = { ...r };
  delete printable.body;
  console.log(JSON.stringify(printable));
}
