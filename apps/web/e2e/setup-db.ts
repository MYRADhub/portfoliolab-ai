// Creates a fresh, deterministic e2e database: migrations, the S&P 500 universe, fixture prices, and a small
// hand-made exposure set. Run before the Playwright suite (see the e2e script).
import { readFileSync, readdirSync } from "node:fs";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { companies, companyFactorExposures, createDb, factors } from "@portfolio-lab/db";
import {
  FixtureProvider,
  ingestPrices,
  loadConstituents,
  type Constituent,
} from "@portfolio-lab/data";
import { adminDatabaseUrl, E2E_DB_NAME, e2eDatabaseUrl, REPO_ROOT } from "./env";

async function main() {
  const admin = postgres(adminDatabaseUrl(), { max: 1, onnotice: () => undefined });
  await admin.unsafe(`drop database if exists ${E2E_DB_NAME} with (force)`);
  await admin.unsafe(`create database ${E2E_DB_NAME}`);
  await admin.end();

  const { db, close } = createDb(e2eDatabaseUrl());
  await migrate(db, {
    migrationsFolder: `${REPO_ROOT}packages/db/migrations`,
  });

  const dir = `${REPO_ROOT}packages/data/snapshots/`;
  const file = readdirSync(dir)
    .filter((f) => f.startsWith("sp500-"))
    .sort()
    .at(-1)!;
  await loadConstituents(db, JSON.parse(readFileSync(`${dir}${file}`, "utf8")) as Constituent[]);

  const provider = new FixtureProvider();
  const today = new Date().toISOString().slice(0, 10);
  const threeYearsAgo = new Date(Date.now() - 3 * 365 * 86_400_000).toISOString().slice(0, 10);
  const twoWeeksAgo = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  for (const t of ["NVDA", "AAPL", "MSFT", "AMZN", "JPM", "XOM"]) {
    await ingestPrices(db, provider, t, { backfillFrom: threeYearsAgo, to: today });
  }
  // TGT has only about ten days of history; GOOGL has none. Both exist to exercise the error paths.
  await ingestPrices(db, provider, "TGT", { backfillFrom: twoWeeksAgo, to: today });

  // Exposures for four of the five main holdings. JPM is deliberately missing to test partial coverage.
  const factorRows = await db
    .insert(factors)
    .values([
      {
        slug: "ai_capex",
        name: "AI infrastructure capex",
        category: "theme",
        description: "e2e fixture",
      },
      {
        slug: "taiwan",
        name: "Taiwan supply chain risk",
        category: "supply_chain",
        description: "e2e fixture",
      },
      { slug: "rates", name: "Interest rates", category: "macro", description: "e2e fixture" },
      {
        slug: "consumer",
        name: "Consumer spending",
        category: "demand",
        description: "e2e fixture",
      },
      { slug: "china", name: "China demand", category: "demand", description: "e2e fixture" },
    ])
    .returning();
  const fid = Object.fromEntries(factorRows.map((f) => [f.slug, f.id]));
  const exposures: [string, string, number, number][] = [
    ["NVDA", "ai_capex", 3, 1],
    ["NVDA", "taiwan", 3, -1],
    ["NVDA", "china", 2, 1],
    ["NVDA", "rates", 1, -1],
    ["AAPL", "taiwan", 2, -1],
    ["AAPL", "china", 2, 1],
    ["AAPL", "consumer", 3, 1],
    ["AAPL", "rates", 1, -1],
    ["MSFT", "ai_capex", 2, 1],
    ["MSFT", "rates", 1, -1],
    ["AMZN", "consumer", 3, 1],
    ["AMZN", "ai_capex", 1, 1],
    ["AMZN", "rates", 2, -1],
  ];
  for (const [ticker, slug, magnitude, direction] of exposures) {
    const [c] = await db.select().from(companies).where(eq(companies.ticker, ticker));
    await db.insert(companyFactorExposures).values({
      companyId: c!.id,
      factorId: fid[slug]!,
      magnitude,
      direction,
      confidence: 0.8,
      rationale: "e2e fixture, not real data",
      source: "manual",
    });
  }
  await close();
  console.log("e2e database ready");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
