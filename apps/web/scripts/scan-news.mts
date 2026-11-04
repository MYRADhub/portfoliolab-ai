// Usage: pnpm --filter @portfolio-lab/web exec tsx scripts/scan-news.mts
// The daily news scan. Scans the example and sample portfolios (every stock a new visitor starts with) for the last
// week's news from the web and, when FINNHUB_API_KEY is set, the news feed, then classifies the strongest stories.
// News is shared by every visitor, so this keeps the News page full without scanning anyone's own portfolio.
// They live under one fixed system session that no browser holds. Needs DATABASE_URL and OPENAI_API_KEY.
import { createOpenAIClassifier } from "@portfolio-lab/classify";
import { FinnhubNewsProvider } from "@portfolio-lab/data";
import { createDb, portfolios, sessions } from "@portfolio-lab/db";
import { createOpenAIWebSearcher } from "@portfolio-lab/explain";
import { asc, eq } from "drizzle-orm";
import { scanPortfolioNews } from "../src/server/news-scan";
import { RateLimiter } from "../src/server/rate-limit";
import { loadExampleData } from "../src/server/samples";

const SYSTEM_SESSION = "00000000-0000-4000-8000-00000000da11";

const url = process.env.DATABASE_URL;
const openai = process.env.OPENAI_API_KEY;
if (!url || !openai) throw new Error("DATABASE_URL and OPENAI_API_KEY are required");

const { db, close } = createDb(url);
try {
  const created = await db
    .insert(sessions)
    .values({ id: SYSTEM_SESSION })
    .onConflictDoNothing()
    .returning({ id: sessions.id });
  if (created.length) await loadExampleData(db, SYSTEM_SESSION);
  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, SYSTEM_SESSION));

  const list = await db
    .select({ id: portfolios.id, name: portfolios.name })
    .from(portfolios)
    .where(eq(portfolios.sessionId, SYSTEM_SESSION))
    .orderBy(asc(portfolios.name));
  const searcher = createOpenAIWebSearcher(openai);
  const finnhub = process.env.FINNHUB_API_KEY;
  const deps = {
    web: { search: (q: string) => searcher.searchNews(q) },
    feed: finnhub ? new FinnhubNewsProvider(finnhub, { retries: 1 }) : null,
    classifier: createOpenAIClassifier(openai),
  };
  // The scheduled job is not a visitor: it gets its own generous allowance instead of the hourly visitor limit.
  const limiter = new RateLimiter(db, 50, 60 * 60 * 1000);
  let failed = 0;
  for (const p of list) {
    const t0 = Date.now();
    try {
      const r = await scanPortfolioNews(db, SYSTEM_SESSION, p.id, deps, { limiter });
      console.log(
        `${p.name}: ${r.inserted} new of ${r.fetched}, ${r.classified} classified, ${r.unclassified} left, ` +
          `${r.failures.length} problems, ${Math.round((Date.now() - t0) / 1000)}s`,
      );
      for (const f of r.failures.slice(0, 5))
        console.log(`  ${f.provider} ${f.ticker}: ${f.error}`);
    } catch (e) {
      failed++;
      console.error(`${p.name}: failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (failed === list.length) process.exitCode = 1;
} finally {
  await close();
}
