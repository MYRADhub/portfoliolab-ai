import {
  check,
  doublePrecision,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  index,
  serial,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./market";

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const portfolios = pgTable(
  "portfolios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    baseCurrency: text("base_currency").notNull().default("USD"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("portfolios_session_idx").on(t.sessionId)],
);

export const holdings = pgTable(
  "holdings",
  {
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id, { onDelete: "cascade" }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    weight: doublePrecision("weight").notNull(),
    shares: doublePrecision("shares"),
    costBasis: doublePrecision("cost_basis"),
  },
  (t) => [
    primaryKey({ columns: [t.portfolioId, t.companyId] }),
    check("holdings_weight_chk", sql`${t.weight} > 0 and ${t.weight} <= 1`),
  ],
);

/** One row per allowed request, used for sliding-window rate limits that hold across server instances. */
export const rateLimitHits = pgTable(
  "rate_limit_hits",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rate_limit_key_at_idx").on(t.key, t.at)],
);
