// Creates a fresh, deterministic e2e database: migrations, the S&P 500 universe, fixture prices, and a small
// hand-made exposure set. Run before the Playwright suite (see the e2e script).
import { readFileSync, readdirSync } from "node:fs";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import {
  companies,
  companyFactorExposures,
  createDb,
  fundamentals,
  eventTypes,
  factors,
  newsArticles,
  newsClassifications,
  newsCompanyLinks,
} from "@portfolio-lab/db";
import {
  FixtureProvider,
  eventTradingDate,
  ingestPrices,
  loadConstituents,
  type Constituent,
} from "@portfolio-lab/data";
import { seedDemoPrices } from "@portfolio-lab/demo";
import { adminDatabaseUrl, E2E_DB_NAME, e2eDatabaseUrl, REPO_ROOT } from "./env";

/** The weekday `n` weekdays before today (UTC). */
function nthWeekdayBack(n: number): string {
  const d = new Date();
  let count = 0;
  while (count < n) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (![0, 6].includes(d.getUTCDay())) count++;
  }
  return d.toISOString().slice(0, 10);
}

const STUDY_EXTRA = ["COST", "MCD", "NKE", "SBUX", "LOW", "TJX"];

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
  // Prices for the 24 companies used by the sample portfolios (no demo news or exposures: tests assert on their own fixtures).
  await seedDemoPrices(db);
  // Six more companies used only by the research study tests; each has a consumer-spending exposure and nothing else.
  for (const t of STUDY_EXTRA)
    await ingestPrices(db, provider, t, { backfillFrom: threeYearsAgo, to: today });
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
  const STUDY_EXTRA_EXPOSURES: [string, string, number, number][] = [
    ["COST", "consumer", 3, 1],
    ["MCD", "consumer", 2, 1],
    ["NKE", "consumer", 3, -1],
    ["SBUX", "consumer", 1, 1],
    ["LOW", "consumer", 2, -1],
    ["TJX", "consumer", 1, -1],
  ];
  const exposures: [string, string, number, number][] = [
    ...STUDY_EXTRA_EXPOSURES,
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

  // Annual figures for NVDA so the fundamentals panel has something to show.
  const [nvda] = await db.select().from(companies).where(eq(companies.ticker, "NVDA"));
  const fy = (year: number, metric: string, value: number, unit = "USD") => ({
    companyId: nvda!.id,
    metric,
    fiscalYear: year,
    periodEnd: `${year}-01-31`,
    value,
    unit,
    filedAt: `${year}-02-20`,
    accession: `e2e-${year}`,
  });
  await db
    .insert(fundamentals)
    .values([
      fy(2025, "revenue", 130_000_000_000),
      fy(2025, "net_income", 72_000_000_000),
      fy(2025, "operating_income", 82_000_000_000),
      fy(2025, "eps_diluted", 2.94, "USD/shares"),
      fy(2025, "equity", 80_000_000_000),
      fy(2024, "revenue", 100_000_000_000),
      fy(2024, "net_income", 30_000_000_000),
    ]);

  // News on a known past trading day, so move tests can assert on exact titles and classifications.
  const newsDate = nthWeekdayBack(6);
  const [guidance] = await db
    .insert(eventTypes)
    .values({
      slug: "guidance_cut",
      name: "Guidance cut",
      defaultClass: "fundamental",
      definition: "e2e fixture",
    })
    .returning();
  const addArticle = async (
    title: string,
    hour: number,
    score: number,
    cluster?: number,
    ticker = "NVDA",
    at?: Date,
  ) => {
    const company = (await db.select().from(companies).where(eq(companies.ticker, ticker)))[0]!;
    const publishedAt = at ?? new Date(`${newsDate}T${String(hour).padStart(2, "0")}:00:00Z`);
    const [a] = await db
      .insert(newsArticles)
      .values({
        provider: "e2e",
        providerId: title,
        url: `https://news.example.com/${encodeURIComponent(title)}`,
        title,
        sourceName: "E2E Wire",
        publishedAt,
        dedupeHash: title,
        marketSession: "regular",
      })
      .returning();
    await db
      .update(newsArticles)
      .set({ clusterId: cluster ?? a!.id })
      .where(eq(newsArticles.id, a!.id));
    await db
      .insert(newsCompanyLinks)
      .values({ articleId: a!.id, companyId: company.id, method: "alias", score });
    return { id: a!.id, publishedAt };
  };
  const classify = async (
    articleId: number,
    cls: "fundamental" | "narrative" | "noise",
    importance: number,
    key: string,
  ) => {
    await db.insert(newsClassifications).values({
      articleId,
      eventTypeId: guidance!.id,
      class: cls,
      fundamentalImportance: importance,
      marketRelevance: 5,
      expectedPersistence: 5,
      mechanism: `E2E mechanism ${key}`,
      confidence: 0.9,
      model: "e2e",
      promptVersion: "e2e",
      contentHash: key,
    });
  };
  const story = (await addArticle("E2E Acme cuts outlook on weak orders", 14, 0.9)).id;
  await addArticle("E2E Acme cuts outlook on weak orders - Wire", 15, 0.8, story);
  await addArticle("E2E Target noise only", 14, 0.3); // weak ambiguous link: must not appear
  await classify(story, "fundamental", 8, "story");

  // Recent news for the radar tests. Titles and classes are chosen so scores differ clearly.
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
  const r1 = await addArticle(
    "E2E Radar NVDA earnings miss",
    0,
    0.9,
    undefined,
    "NVDA",
    hoursAgo(2),
  );
  await classify(r1.id, "fundamental", 9, "r1");
  await addArticle("E2E Radar NVDA earnings miss - Wire", 0, 0.8, r1.id, "NVDA", hoursAgo(1.5));
  const r2 = await addArticle(
    "E2E Radar AAPL product buzz",
    0,
    0.8,
    undefined,
    "AAPL",
    hoursAgo(26),
  );
  await classify(r2.id, "narrative", 5, "r2");
  const r3 = await addArticle(
    "E2E Radar MSFT celebrity gossip",
    0,
    0.9,
    undefined,
    "MSFT",
    hoursAgo(5),
  );
  await classify(r3.id, "noise", 1, "r3");
  await addArticle("E2E Radar AMZN unclassified", 0, 0.8, undefined, "AMZN", hoursAgo(3));
  await addArticle("E2E Radar JPM stale rumor", 0, 0.5, undefined, "JPM", hoursAgo(24 * 6)); // old, weak, unclassified: collapsed

  // A trading day on which no seeded news lands, for tests that need an empty day.
  const eventDays = new Set(
    [hoursAgo(2), hoursAgo(1.5), hoursAgo(26), hoursAgo(5), hoursAgo(3), hoursAgo(24 * 6)].map(
      (d) => eventTradingDate(d),
    ),
  );
  eventDays.add(newsDate);
  const quietDate = [1, 2, 3, 4, 5].map(nthWeekdayBack).find((d) => !eventDays.has(d));
  if (!quietDate) throw new Error("could not find a quiet day for the fixtures");

  writeFileSync(`${REPO_ROOT}apps/web/e2e/.fixtures.json`, JSON.stringify({ newsDate, quietDate }));
  writeFileSync(`${REPO_ROOT}apps/web/e2e/.counter`, "0");

  await close();
  console.log("e2e database ready");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
