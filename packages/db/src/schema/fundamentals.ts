import {
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  date,
  uniqueIndex,
  smallint,
} from "drizzle-orm/pg-core";
import { companies } from "./market";

/** Annual figures from SEC 10-K filings (XBRL company facts), one row per company, metric and fiscal year. */
export const fundamentals = pgTable(
  "fundamentals",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    fiscalYear: smallint("fiscal_year").notNull(),
    periodEnd: date("period_end").notNull(),
    value: doublePrecision("value").notNull(),
    unit: text("unit").notNull(),
    filedAt: date("filed_at").notNull(),
    accession: text("accession").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("fundamentals_key_idx").on(t.companyId, t.metric, t.fiscalYear)],
);
