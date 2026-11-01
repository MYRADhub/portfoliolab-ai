import {
  check,
  index,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { portfolios, sessions } from "./portfolio";

/** A research conversation. Belongs to one anonymous session; may be tied to one of its portfolios. */
export const researchThreads = pgTable(
  "research_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    portfolioId: uuid("portfolio_id").references(() => portfolios.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("research_threads_session_idx").on(t.sessionId, t.updatedAt)],
);

/**
 * One question or answer. An answer keeps everything needed to show and audit it again: the facts it may cite, the
 * tool calls, the chosen tables and charts, whether it passed the grounding check, and the prompt version.
 */
export const researchMessages = pgTable(
  "research_messages",
  {
    id: serial("id").primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => researchThreads.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    mode: text("mode"),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("research_messages_thread_idx").on(t.threadId, t.id),
    check("research_messages_role_chk", sql`${t.role} in ('user', 'assistant')`),
  ],
);

/** The presentation made from a conversation. One per conversation; making it again replaces it. */
export const researchDecks = pgTable(
  "research_decks",
  {
    id: serial("id").primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => researchThreads.id, { onDelete: "cascade" }),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("research_decks_thread_idx").on(t.threadId)],
);
