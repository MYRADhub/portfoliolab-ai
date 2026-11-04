import { and, asc, desc, eq, sql } from "drizzle-orm";
import { portfolios, researchMessages, researchThreads, type Db } from "@portfolio-lab/db";
import {
  runAssistant,
  type AssistantAnswer,
  type AssistantEvent,
  type AssistantModel,
  type Fact,
  type WebSearcher,
} from "@portfolio-lab/explain";
import { withHistory, type Turn } from "./assistant";
import { compareFacts, type FactChanges } from "./fact-changes";
import { AppError } from "./errors";
import { DISCLAIMER } from "./explain";
import { RateLimiter, type Limiter } from "./rate-limit";
import { buildResearchTools, type EdgarLike } from "./research-tools";

export type ResearchMode = "quick" | "deep";
export const RESEARCH_QUESTION_MAX = 2000;
/** Earlier verified answers sent along as context. */
export const CONTEXT_TURNS = 6;
export const CONTEXT_ANSWER_MAX = 2000;
export const TITLE_MAX = 80;
/** Separate from the 10-per-hour explanation allowance: research questions cost more and are asked more often. */
export const RESEARCH_LIMITS: Record<ResearchMode, { max: number; windowMs: number }> = {
  quick: { max: 30, windowMs: 60 * 60 * 1000 },
  deep: { max: 6, windowMs: 60 * 60 * 1000 },
};
export const THREADS_LISTED = 50;

export interface ThreadSummary {
  id: string;
  title: string;
  portfolioId: string | null;
  updatedAt: string;
}

export interface StoredAnswer extends AssistantAnswer {
  mode: ResearchMode;
  /** Set when this answer re-ran an earlier one: what changed in the figures since then. */
  refresh?: { of: number; since: string; changes: FactChanges };
}

/** Labels of the earlier figures handed to a refresh, so they are kept apart from the fresh ones. */
export const EARLIER_PREFIX = "Earlier answer";

export type ChatMessage =
  | { id: number; role: "user"; content: string; mode: ResearchMode | null; createdAt: string }
  | {
      id: number;
      role: "assistant";
      content: string;
      mode: ResearchMode | null;
      createdAt: string;
      answer: StoredAnswer;
    };

export function titleFrom(question: string): string {
  const one = question.replace(/\s+/g, " ").trim();
  return one.length <= TITLE_MAX ? one : `${one.slice(0, TITLE_MAX - 1).replace(/\s+\S*$/, "")}...`;
}

export async function listThreads(db: Db, sessionId: string): Promise<ThreadSummary[]> {
  const rows = await db
    .select()
    .from(researchThreads)
    .where(eq(researchThreads.sessionId, sessionId))
    .orderBy(desc(researchThreads.updatedAt))
    .limit(THREADS_LISTED);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    portfolioId: r.portfolioId,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

async function ownedThread(db: Db, sessionId: string, id: string) {
  const [t] = await db
    .select()
    .from(researchThreads)
    .where(and(eq(researchThreads.id, id), eq(researchThreads.sessionId, sessionId)));
  if (!t) throw new AppError("not_found", "Conversation not found");
  return t;
}

function toMessage(r: typeof researchMessages.$inferSelect): ChatMessage {
  const base = {
    id: r.id,
    content: r.content,
    mode: (r.mode as ResearchMode | null) ?? null,
    createdAt: r.createdAt.toISOString(),
  };
  return r.role === "assistant"
    ? { ...base, role: "assistant", answer: r.payload as StoredAnswer }
    : { ...base, role: "user" };
}

export async function getThread(
  db: Db,
  sessionId: string,
  id: string,
): Promise<{ thread: ThreadSummary; messages: ChatMessage[]; disclaimer: string }> {
  const t = await ownedThread(db, sessionId, id);
  const rows = await db
    .select()
    .from(researchMessages)
    .where(eq(researchMessages.threadId, id))
    .orderBy(asc(researchMessages.id));
  return {
    thread: {
      id: t.id,
      title: t.title,
      portfolioId: t.portfolioId,
      updatedAt: t.updatedAt.toISOString(),
    },
    messages: rows.map(toMessage),
    disclaimer: DISCLAIMER,
  };
}

export async function deleteThread(db: Db, sessionId: string, id: string): Promise<void> {
  await ownedThread(db, sessionId, id);
  await db.delete(researchThreads).where(eq(researchThreads.id, id));
}

/** Question/answer pairs whose answer passed the check, oldest first. Fallbacks and unanswered questions are skipped. */
export function verifiedTurns(messages: readonly ChatMessage[]): Turn[] {
  const out: Turn[] = [];
  for (let i = 0; i + 1 < messages.length; i++) {
    const q = messages[i]!;
    const a = messages[i + 1]!;
    if (q.role === "user" && a.role === "assistant" && a.answer?.source === "model") {
      out.push({ question: q.content, answer: a.content.slice(0, CONTEXT_ANSWER_MAX) });
      i++;
    }
  }
  return out.slice(-CONTEXT_TURNS);
}

export interface ResearchRequest {
  threadId?: string;
  /** Ignored when refreshing: the earlier question is asked again. */
  question: string;
  mode: ResearchMode;
  portfolioId?: string | null;
  /** Id of an earlier answer in the same thread to run again and compare with. */
  refreshOf?: number;
}

export interface PreparedResearch {
  threadId: string;
  title: string;
  created: boolean;
  question: string;
  mode: ResearchMode;
  portfolioId: string | null;
  history: Turn[];
  refresh: { of: number; since: string; facts: Fact[] } | null;
}

/**
 * Everything that can fail with a clear error before work starts: validation, ownership, the rate limit, and creating
 * the thread. The question is stored here so it is kept even if the answer is stopped.
 */
export async function prepareResearch(
  db: Db,
  sessionId: string,
  req: ResearchRequest,
  opts: { limiter?: Limiter } = {},
): Promise<PreparedResearch> {
  const existing = req.threadId ? await ownedThread(db, sessionId, req.threadId) : null;
  let refresh: PreparedResearch["refresh"] = null;
  let question = req.question.trim();
  if (req.refreshOf !== undefined) {
    if (!existing)
      throw new AppError("bad_request", "A refresh needs the conversation it belongs to");
    const prior = (await getThread(db, sessionId, existing.id)).messages;
    const i = prior.findIndex((m) => m.id === req.refreshOf && m.role === "assistant");
    const q = prior[i - 1];
    const a = prior[i];
    if (i < 1 || q?.role !== "user" || a?.role !== "assistant")
      throw new AppError("not_found", "Answer to refresh not found");
    question = q.content;
    refresh = { of: a.id, since: a.createdAt, facts: a.answer.facts };
  }
  if (question.length < 3 || question.length > RESEARCH_QUESTION_MAX)
    throw new AppError("bad_request", `Question must be 3 to ${RESEARCH_QUESTION_MAX} characters`);
  const portfolioId = req.portfolioId ?? null;
  if (portfolioId) {
    const [p] = await db
      .select({ id: portfolios.id })
      .from(portfolios)
      .where(and(eq(portfolios.id, portfolioId), eq(portfolios.sessionId, sessionId)));
    if (!p) throw new AppError("not_found", "Portfolio not found");
  }

  const limit = RESEARCH_LIMITS[req.mode];
  const limiter = opts.limiter ?? new RateLimiter(db, limit.max, limit.windowMs);
  if (!(await limiter.tryAcquire(`research:${req.mode}:${sessionId}`)))
    throw new AppError(
      "rate_limited",
      req.mode === "deep"
        ? `Deep research is limited to ${limit.max} reports an hour. Try a quick question, or try again later.`
        : `Research questions are limited to ${limit.max} an hour. Try again later.`,
    );

  let history: Turn[] = [];
  let thread = existing;
  if (thread) {
    const prior = await getThread(db, sessionId, thread.id);
    history = verifiedTurns(prior.messages);
  } else {
    [thread] = await db
      .insert(researchThreads)
      .values({ sessionId, title: titleFrom(question), portfolioId })
      .returning();
  }
  await db.insert(researchMessages).values({
    threadId: thread!.id,
    role: "user",
    content: question,
    mode: req.mode,
  });
  await db
    .update(researchThreads)
    .set({ updatedAt: sql`now()`, portfolioId })
    .where(eq(researchThreads.id, thread!.id));
  return {
    threadId: thread!.id,
    title: thread!.title,
    created: !existing,
    question,
    mode: req.mode,
    portfolioId,
    history,
    refresh,
  };
}

export interface ResearchDeps {
  model: AssistantModel;
  web: WebSearcher | null;
  edgar: EdgarLike | null;
}

/** Runs the assistant for a prepared question and stores the answer. Throws AssistantAborted when stopped. */
export async function executeResearch(
  db: Db,
  sessionId: string,
  p: PreparedResearch,
  deps: ResearchDeps,
  opts: { signal?: AbortSignal; onEvent?: (e: AssistantEvent) => void; now?: Date } = {},
): Promise<ChatMessage> {
  const tools = buildResearchTools({
    db,
    sessionId,
    portfolioId: p.portfolioId,
    now: opts.now,
    web: deps.web,
    edgar: deps.edgar,
  });
  const today = (opts.now ?? new Date()).toISOString().slice(0, 10);
  let context = `Today is ${today}.${p.portfolioId ? " The user has a portfolio selected; portfolio tools are available." : ""}`;
  const refresh = p.refresh;
  if (refresh) {
    const since = refresh.since.slice(0, 10);
    tools.push({
      name: "get_earlier_figures",
      description: `The figures behind the earlier answer to this question, from ${since}, for saying what changed.`,
      parameters: { type: "object", properties: {}, additionalProperties: false },
      run: async () =>
        refresh.facts.map((f) => ({
          label: `${EARLIER_PREFIX} (${since}): ${f.label}`,
          text: f.text,
          ...(f.kind ? { kind: f.kind } : {}),
          ...(f.source ? { source: f.source } : {}),
        })),
    });
    context += ` This question was answered before, on ${since}. Answer it again with fresh tool calls, call get_earlier_figures, and start with what changed since then.`;
  }
  const answer = await runAssistant(
    deps.model,
    `${context}\n\n${withHistory(p.question, p.history)}`,
    tools,
    { mode: p.mode, signal: opts.signal, onEvent: opts.onEvent },
  );
  const stored: StoredAnswer = { ...answer, mode: p.mode };
  if (refresh)
    stored.refresh = {
      of: refresh.of,
      since: refresh.since,
      changes: compareFacts(
        refresh.facts,
        answer.facts.filter((f) => !f.label.startsWith(EARLIER_PREFIX)),
      ),
    };
  const [row] = await db
    .insert(researchMessages)
    .values({
      threadId: p.threadId,
      role: "assistant",
      content: answer.answer,
      mode: p.mode,
      payload: stored,
    })
    .returning();
  await db
    .update(researchThreads)
    .set({ updatedAt: sql`now()` })
    .where(eq(researchThreads.id, p.threadId));
  return toMessage(row!);
}
