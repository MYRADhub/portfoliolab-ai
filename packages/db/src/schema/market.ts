import {
  boolean,
  date,
  doublePrecision,
  bigint,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const companies = pgTable(
  "companies",
  {
    id: serial("id").primaryKey(),
    ticker: text("ticker").notNull(),
    name: text("name").notNull(),
    exchange: text("exchange"),
    sector: text("sector"),
    industry: text("industry"),
    country: text("country"),
    /** SEC Central Index Key, zero-padded to 10 digits. Used to look up filings and fundamentals. */
    cik: text("cik"),
    marketCap: doublePrecision("market_cap"),
    activeFrom: date("active_from"),
    activeTo: date("active_to"),
  },
  (t) => [uniqueIndex("companies_ticker_idx").on(t.ticker)],
);

export const pricesDaily = pgTable(
  "prices_daily",
  {
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    open: doublePrecision("open"),
    high: doublePrecision("high"),
    low: doublePrecision("low"),
    close: doublePrecision("close").notNull(),
    adjClose: doublePrecision("adj_close").notNull(),
    volume: bigint("volume", { mode: "number" }),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.date] })],
);

export const dataSources = pgTable("data_sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
