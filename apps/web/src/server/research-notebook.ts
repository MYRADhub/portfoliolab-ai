import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import {
  portfolios,
  researchDecks,
  researchMessages,
  researchPins,
  researchThreads,
  type Db,
} from "@portfolio-lab/db";
import type { DeckGenerator } from "@portfolio-lab/explain";
import { AppError } from "./errors";
import type { ChatMessage, StoredAnswer } from "./research-chat";
import { buildAndStore, deckInputFrom, type StoredDeck } from "./research-deck";
import type { Limiter } from "./rate-limit";

export const MAX_PINS = 200;
export const NOTE_MAX = 2000;

export interface Pin {
  id: number;
  portfolioId: string | null;
  displayId: string | null;
  note: string | null;
  createdAt: string;
  question: string;
  answer: StoredAnswer;
  content: string;
  messageId: number;
  thread: { id: string; title: string };
}

async function ownedPortfolio(db: Db, sessionId: string, portfolioId: string | null) {
  if (!portfolioId) return null;
  const [p] = await db
    .select({ id: portfolios.id, name: portfolios.name })
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.sessionId, sessionId)));
  if (!p) throw new AppError("not_found", "Portfolio not found");
  return p;
}

/** The pins of one notebook (a portfolio's, or General with null), oldest first, with the answer and its question. */
export async function listPins(
  db: Db,
  sessionId: string,
  portfolioId: string | null,
): Promise<Pin[]> {
  await ownedPortfolio(db, sessionId, portfolioId);
  const rows = await db
    .select({
      pin: researchPins,
      message: researchMessages,
      thread: { id: researchThreads.id, title: researchThreads.title },
    })
    .from(researchPins)
    .innerJoin(researchMessages, eq(researchMessages.id, researchPins.messageId))
    .innerJoin(researchThreads, eq(researchThreads.id, researchMessages.threadId))
    .where(
      and(
        eq(researchPins.sessionId, sessionId),
        portfolioId ? eq(researchPins.portfolioId, portfolioId) : isNull(researchPins.portfolioId),
      ),
    )
    .orderBy(asc(researchPins.createdAt), asc(researchPins.id));
  // The question is the user message just before each answer in its thread.
  const questions = new Map<number, string>();
  for (const r of rows) {
    if (questions.has(r.message.id)) continue;
    const [q] = await db
      .select({ content: researchMessages.content })
      .from(researchMessages)
      .where(
        and(
          eq(researchMessages.threadId, r.message.threadId),
          eq(researchMessages.role, "user"),
          sql`${researchMessages.id} < ${r.message.id}`,
        ),
      )
      .orderBy(sql`${researchMessages.id} desc`)
      .limit(1);
    questions.set(r.message.id, q?.content ?? "");
  }
  return rows.map((r) => ({
    id: r.pin.id,
    portfolioId: r.pin.portfolioId,
    displayId: r.pin.displayId,
    note: r.pin.note,
    createdAt: r.pin.createdAt.toISOString(),
    question: questions.get(r.message.id) ?? "",
    answer: r.message.payload as StoredAnswer,
    content: r.message.content,
    messageId: r.message.id,
    thread: r.thread,
  }));
}

/** Pins an answer, or one chart of it, to a notebook. Pinning the same thing twice returns the existing pin. */
export async function addPin(
  db: Db,
  sessionId: string,
  input: {
    messageId: number;
    displayId?: string | null;
    portfolioId?: string | null;
    note?: string | null;
  },
): Promise<{ id: number; created: boolean }> {
  const portfolioId = input.portfolioId ?? null;
  await ownedPortfolio(db, sessionId, portfolioId);
  const [m] = await db
    .select({ message: researchMessages })
    .from(researchMessages)
    .innerJoin(researchThreads, eq(researchThreads.id, researchMessages.threadId))
    .where(and(eq(researchMessages.id, input.messageId), eq(researchThreads.sessionId, sessionId)));
  if (!m || m.message.role !== "assistant") throw new AppError("not_found", "Answer not found");
  const displayId = input.displayId ?? null;
  if (displayId) {
    const a = m.message.payload as StoredAnswer;
    if (!(a.allDisplays ?? a.displays).some((d) => d.id === displayId))
      throw new AppError("not_found", "Chart not found in that answer");
  }
  const note = input.note?.trim() || null;
  if (note && note.length > NOTE_MAX)
    throw new AppError("bad_request", `Notes are at most ${NOTE_MAX} characters`);

  const [dup] = await db
    .select({ id: researchPins.id })
    .from(researchPins)
    .where(
      and(
        eq(researchPins.sessionId, sessionId),
        eq(researchPins.messageId, input.messageId),
        displayId ? eq(researchPins.displayId, displayId) : isNull(researchPins.displayId),
        portfolioId ? eq(researchPins.portfolioId, portfolioId) : isNull(researchPins.portfolioId),
      ),
    );
  if (dup) return { id: dup.id, created: false };
  const [n] = await db
    .select({ n: count() })
    .from(researchPins)
    .where(eq(researchPins.sessionId, sessionId));
  if ((n?.n ?? 0) >= MAX_PINS)
    throw new AppError("conflict", `A notebook holds at most ${MAX_PINS} pins. Remove some first.`);
  const [row] = await db
    .insert(researchPins)
    .values({ sessionId, portfolioId, messageId: input.messageId, displayId, note })
    .returning({ id: researchPins.id });
  return { id: row!.id, created: true };
}

async function ownedPin(db: Db, sessionId: string, id: number) {
  const [p] = await db
    .select()
    .from(researchPins)
    .where(and(eq(researchPins.id, id), eq(researchPins.sessionId, sessionId)));
  if (!p) throw new AppError("not_found", "Pin not found");
  return p;
}

export async function updatePinNote(db: Db, sessionId: string, id: number, note: string | null) {
  await ownedPin(db, sessionId, id);
  const n = note?.trim() || null;
  if (n && n.length > NOTE_MAX)
    throw new AppError("bad_request", `Notes are at most ${NOTE_MAX} characters`);
  await db.update(researchPins).set({ note: n }).where(eq(researchPins.id, id));
}

export async function deletePin(db: Db, sessionId: string, id: number) {
  await ownedPin(db, sessionId, id);
  await db.delete(researchPins).where(eq(researchPins.id, id));
}

export function notebookKey(sessionId: string, portfolioId: string | null): string {
  return `${sessionId}:${portfolioId ?? "none"}`;
}

/**
 * The pins as a conversation for the deck builder: each pinned answer once, in pin order, with its question. A pinned
 * chart becomes that answer's chosen chart; a whole-answer pin keeps the answer's own choice. Unverified answers are
 * left out by the deck builder, as for a conversation.
 */
export function pinsAsMessages(pins: readonly Pin[]): ChatMessage[] {
  const byMessage = new Map<number, { pin: Pin; charts: Set<string> | null }>();
  for (const p of pins) {
    const cur = byMessage.get(p.messageId);
    if (!cur)
      byMessage.set(p.messageId, { pin: p, charts: p.displayId ? new Set([p.displayId]) : null });
    else if (cur.charts && p.displayId) cur.charts.add(p.displayId);
    else cur.charts = null;
  }
  const out: ChatMessage[] = [];
  for (const { pin, charts } of byMessage.values()) {
    const all = pin.answer.allDisplays ?? pin.answer.displays;
    const answer: StoredAnswer = charts
      ? { ...pin.answer, displays: all.filter((d) => charts.has(d.id)) }
      : pin.answer;
    out.push(
      {
        id: pin.messageId * 2 - 1,
        role: "user",
        content: pin.question,
        mode: null,
        createdAt: pin.createdAt,
      },
      {
        id: pin.messageId * 2,
        role: "assistant",
        content: pin.content,
        mode: null,
        createdAt: pin.createdAt,
        answer,
      },
    );
  }
  return out;
}

export async function getNotebookDeck(
  db: Db,
  sessionId: string,
  portfolioId: string | null,
): Promise<StoredDeck | null> {
  await ownedPortfolio(db, sessionId, portfolioId);
  const [row] = await db
    .select()
    .from(researchDecks)
    .where(eq(researchDecks.notebookKey, notebookKey(sessionId, portfolioId)));
  return row ? (row.payload as StoredDeck) : null;
}

export async function makeNotebookDeck(
  db: Db,
  sessionId: string,
  portfolioId: string | null,
  gen: DeckGenerator,
  opts: { limiter?: Limiter } = {},
): Promise<StoredDeck> {
  const p = await ownedPortfolio(db, sessionId, portfolioId);
  const pins = await listPins(db, sessionId, portfolioId);
  const title = p ? `Research notebook: ${p.name}` : "Research notebook";
  return buildAndStore(
    db,
    sessionId,
    deckInputFrom(title, pinsAsMessages(pins)),
    gen,
    { notebookKey: notebookKey(sessionId, portfolioId) },
    opts,
  );
}
