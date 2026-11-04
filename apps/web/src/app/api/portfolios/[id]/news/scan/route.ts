import { z } from "zod";
import { createOpenAIClassifier } from "@portfolio-lab/classify";
import { FinnhubNewsProvider } from "@portfolio-lab/data";
import { createOpenAIWebSearcher } from "@portfolio-lab/explain";
import { aiLimiterFor } from "@/server/ai-guard";
import { requireSessionId } from "@/server/current-session";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { route } from "@/server/errors";
import { scanPortfolioNews } from "@/server/news-scan";

const paramsSchema = z.object({ id: z.string().uuid() });

/** Searches the web (and the news feed, when a key is set) for the last week's news about every holding. */
export const POST = route<{ id: string }>(async (req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  const e = env();
  const searcher = e.OPENAI_API_KEY ? createOpenAIWebSearcher(e.OPENAI_API_KEY) : null;
  return Response.json(
    await scanPortfolioNews(
      db(),
      sid,
      id,
      {
        web: searcher ? { search: (q) => searcher.searchNews(q) } : null,
        feed: e.FINNHUB_API_KEY ? new FinnhubNewsProvider(e.FINNHUB_API_KEY, { retries: 1 }) : null,
        classifier: e.OPENAI_API_KEY ? createOpenAIClassifier(e.OPENAI_API_KEY) : null,
      },
      { limiter: aiLimiterFor(req, "news_scan") },
    ),
  );
});
