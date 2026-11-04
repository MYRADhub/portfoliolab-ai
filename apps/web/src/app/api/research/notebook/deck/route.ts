import { z } from "zod";
import { createOpenAIDeckGenerator } from "@portfolio-lab/explain";
import { aiLimiterFor } from "@/server/ai-guard";
import { requireSessionId } from "@/server/current-session";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { AppError, route } from "@/server/errors";
import { getNotebookDeck, makeNotebookDeck } from "@/server/research-notebook";

const portfolioParam = z.string().uuid().nullable();
const pid = (req: Request) =>
  portfolioParam.parse(new URL(req.url).searchParams.get("portfolioId") || null);

export const GET = route(async (req) => {
  const sid = await requireSessionId();
  return Response.json({ deck: await getNotebookDeck(db(), sid, pid(req)) });
});

/** Makes the presentation for a notebook from its pinned verified answers, replacing any earlier one. */
export const POST = route(async (req) => {
  const sid = await requireSessionId();
  const key = env().OPENAI_API_KEY;
  if (!key) throw new AppError("unavailable", "Presentations are not configured on this server");
  return Response.json({
    deck: await makeNotebookDeck(db(), sid, pid(req), createOpenAIDeckGenerator(key), {
      limiter: aiLimiterFor(req, "deck"),
    }),
  });
});
