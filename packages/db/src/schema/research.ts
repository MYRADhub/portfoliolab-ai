import {
  check,
  index,
  integer,
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
    /** Set for a conversation's deck. */
    threadId: uuid("thread_id").references(() => researchThreads.id, { onDelete: "cascade" }),
    /** Set for a notebook's deck: "<session id>:<portfolio id or none>". */
    notebookKey: text("notebook_key"),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("research_decks_thread_idx").on(t.threadId),
    uniqueIndex("research_decks_notebook_idx").on(t.notebookKey),
    check("research_decks_owner_chk", sql`(${t.threadId} is null) <> (${t.notebookKey} is null)`),
  ],
);

/**
 * An answer, or one chart of it, kept in a research notebook. A notebook belongs to a portfolio, or to none ("General").
 * Pins of a deleted portfolio fall back to General rather than disappear.
 */
export const researchPins = pgTable(
  "research_pins",
  {
    id: serial("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    portfolioId: uuid("portfolio_id").references(() => portfolios.id, { onDelete: "set null" }),
    messageId: integer("message_id")
      .notNull()
      .references(() => researchMessages.id, { onDelete: "cascade" }),
    /** A chart or table id (D3) to pin on its own; null pins the whole answer. */
    displayId: text("display_id"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("research_pins_session_idx").on(t.sessionId, t.portfolioId, t.createdAt)],
);
