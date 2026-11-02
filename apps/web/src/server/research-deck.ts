import { eq } from "drizzle-orm";
import { researchDecks, type Db } from "@portfolio-lab/db";
import {
  generateDeck,
  type DeckGenerator,
  type DeckInput,
  type DeckResult,
  type Fact,
  type ShownDisplay,
} from "@portfolio-lab/explain";
import { AppError } from "./errors";
import { DISCLAIMER } from "./explain";
import { RateLimiter } from "./rate-limit";
import { getThread, type ChatMessage, type StoredAnswer } from "./research-chat";

export const DECK_LIMIT = { max: 10, windowMs: 60 * 60 * 1000 };

export interface StoredDeck extends DeckResult {
  /** The conversation it was made from, or null for a notebook's deck. */
  threadId: string | null;
  createdAt: string;
  disclaimer: string;
}

const CITATION = /\[\s*F\d+(?:\s*,\s*F\d+)*\s*\]/g;

/** Answers saved before every display was kept only have the chosen ones. */
function allOf(a: StoredAnswer): ShownDisplay[] {
  return a.allDisplays ?? a.displays ?? [];
}

/**
 * The verified answers of a conversation as one deck input. Each answer numbers its facts and displays from 1, so
 * they are renumbered across the conversation (identical facts share an id) and the answers' citations rewritten.
 */
export function deckInputFrom(title: string, messages: readonly ChatMessage[]): DeckInput {
  const facts: Fact[] = [];
  const displays: ShownDisplay[] = [];
  const sections: DeckInput["sections"] = [];
  const factId = (f: Fact): string => {
    const found = facts.find((x) => x.label === f.label && x.text === f.text);
    if (found) return found.id;
    const id = `F${facts.length + 1}`;
    facts.push({ ...f, id });
    return id;
  };
  for (let i = 0; i + 1 < messages.length; i++) {
    const q = messages[i]!;
    const a = messages[i + 1]!;
    if (q.role !== "user" || a.role !== "assistant" || a.answer?.source !== "model") continue;
    i++;
    const fmap = new Map(a.answer.facts.map((f) => [f.id, factId(f)]));
    const dmap = new Map<string, string>();
    for (const d of allOf(a.answer)) {
      const id = `D${displays.length + 1}`;
      displays.push({ ...d, id });
      dmap.set(d.id, id);
    }
    const answer = a.content.replace(CITATION, (group) =>
      group.replace(/F\d+/g, (id) => fmap.get(id) ?? id),
    );
    const cited = [
      ...new Set(
        [...a.content.matchAll(CITATION)].flatMap((m) =>
          [...m[0].matchAll(/F\d+/g)].map((x) => fmap.get(x[0])).filter((x): x is string => !!x),
        ),
      ),
    ];
    sections.push({
      question: q.content,
      answer,
      factIds: cited,
      displayIds: a.answer.displays.map((d) => dmap.get(d.id)).filter((x): x is string => !!x),
    });
  }
  return { topic: title, sections, facts, displays };
}

export async function getDeck(
  db: Db,
  sessionId: string,
  threadId: string,
): Promise<StoredDeck | null> {
  await getThread(db, sessionId, threadId);
  const [row] = await db.select().from(researchDecks).where(eq(researchDecks.threadId, threadId));
  return row ? (row.payload as StoredDeck) : null;
}

/** Makes (or remakes) the presentation for a conversation from its verified answers. */
export async function makeDeck(
  db: Db,
  sessionId: string,
  threadId: string,
  gen: DeckGenerator,
  opts: { limiter?: RateLimiter } = {},
): Promise<StoredDeck> {
  const t = await getThread(db, sessionId, threadId);
  return buildAndStore(
    db,
    sessionId,
    deckInputFrom(t.thread.title, t.messages),
    gen,
    { threadId },
    opts,
  );
}

export type DeckOwner = { threadId: string } | { notebookKey: string };

/** Checks there is something to present and the allowance, then generates, checks and stores the deck. */
export async function buildAndStore(
  db: Db,
  sessionId: string,
  input: DeckInput,
  gen: DeckGenerator,
  owner: DeckOwner,
  opts: { limiter?: RateLimiter } = {},
): Promise<StoredDeck> {
  if (input.sections.length === 0)
    throw new AppError(
      "bad_request",
      "threadId" in owner
        ? "This conversation has no verified answers yet. Ask a question that gets one first."
        : "This notebook has no verified answers pinned yet.",
    );
  const limiter = opts.limiter ?? new RateLimiter(db, DECK_LIMIT.max, DECK_LIMIT.windowMs);
  if (!(await limiter.tryAcquire(`deck:${sessionId}`)))
    throw new AppError(
      "rate_limited",
      `Presentations are limited to ${DECK_LIMIT.max} an hour. Try again later.`,
    );
  const result = await generateDeck(gen, input);
  const stored: StoredDeck = {
    ...result,
    threadId: "threadId" in owner ? owner.threadId : null,
    createdAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
  };
  if ("threadId" in owner)
    await db
      .insert(researchDecks)
      .values({ threadId: owner.threadId, payload: stored })
      .onConflictDoUpdate({
        target: researchDecks.threadId,
        set: { payload: stored, createdAt: new Date() },
      });
  else
    await db
      .insert(researchDecks)
      .values({ notebookKey: owner.notebookKey, payload: stored })
      .onConflictDoUpdate({
        target: researchDecks.notebookKey,
        set: { payload: stored, createdAt: new Date() },
      });
  return stored;
}
