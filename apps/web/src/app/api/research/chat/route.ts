import { z } from "zod";
import { EdgarClient } from "@portfolio-lab/data";
import {
  AssistantAborted,
  createOpenAIAssistantModel,
  createOpenAIWebSearcher,
} from "@portfolio-lab/explain";
import { aiLimiterFor } from "@/server/ai-guard";
import { requireSessionId } from "@/server/current-session";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { AppError, route } from "@/server/errors";
import { DISCLAIMER } from "@/server/explain";
import { logger } from "@/server/logger";
import {
  executeResearch,
  prepareResearch,
  RESEARCH_QUESTION_MAX,
  type ResearchDeps,
} from "@/server/research-chat";

const bodySchema = z.object({
  question: z
    .string()
    .max(RESEARCH_QUESTION_MAX + 200)
    .default(""),
  mode: z.enum(["quick", "deep"]).default("quick"),
  threadId: z.string().uuid().optional(),
  portfolioId: z.string().uuid().nullable().optional(),
  refreshOf: z.number().int().positive().optional(),
});

function deps(): ResearchDeps {
  const e = env();
  if (!e.OPENAI_API_KEY)
    throw new AppError("unavailable", "The research assistant is not configured on this server");
  return {
    model: createOpenAIAssistantModel(e.OPENAI_API_KEY),
    web: createOpenAIWebSearcher(e.OPENAI_API_KEY),
    edgar: e.SEC_USER_AGENT ? new EdgarClient(e.SEC_USER_AGENT, { retries: 2 }) : null,
  };
}

/**
 * Answers a research question as a stream of newline-delimited JSON events: the thread, each tool as it starts and
 * finishes, the check, and finally the verified answer. Validation and rate-limit errors come back as ordinary JSON
 * errors before the stream starts. Closing the connection stops the work.
 */
export const POST = route(async (req, requestId) => {
  const sid = await requireSessionId();
  const body = bodySchema.parse(await req.json());
  const d = deps();
  const database = db();
  const prepared = await prepareResearch(database, sid, body, {
    limiter: aiLimiterFor(req, body.mode === "deep" ? "research_deep" : "research_quick"),
  });

  const ctl = new AbortController();
  req.signal?.addEventListener("abort", () => ctl.abort());
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        if (ctl.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          ctl.abort();
        }
      };
      send({
        type: "thread",
        threadId: prepared.threadId,
        title: prepared.title,
        created: prepared.created,
      });
      try {
        const message = await executeResearch(database, sid, prepared, d, {
          signal: ctl.signal,
          onEvent: send,
        });
        send({ type: "answer", message, disclaimer: DISCLAIMER });
      } catch (err) {
        if (!(err instanceof AssistantAborted) && !ctl.signal.aborted) {
          logger.error(
            { requestId, err: err instanceof Error ? err.message : String(err) },
            "research failed",
          );
          send({ type: "error", message: "The research assistant failed. Try again." });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      }
    },
    cancel() {
      ctl.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
});
