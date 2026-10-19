import {
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  check,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./market";

export const factorCategory = pgEnum("factor_category", [
  "macro",
  "commodity",
  "geography",
  "supply_chain",
  "theme",
  "regulation",
  "demand",
]);

export const exposureSource = pgEnum("exposure_source", ["manual", "llm_seeded", "llm_updated"]);

export const factors = pgTable(
  "factors",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    category: factorCategory("category").notNull(),
    description: text("description").notNull(),
    risesMeans: text("rises_means"),
  },
  (t) => [uniqueIndex("factors_slug_idx").on(t.slug)],
);

export const factorRelationships = pgTable(
  "factor_relationships",
  {
    srcFactorId: integer("src_factor_id")
      .notNull()
      .references(() => factors.id, { onDelete: "cascade" }),
    dstFactorId: integer("dst_factor_id")
      .notNull()
      .references(() => factors.id, { onDelete: "cascade" }),
    direction: smallint("direction").notNull(),
    strength: doublePrecision("strength").notNull(),
    rationale: text("rationale"),
  },
  (t) => [
    primaryKey({ columns: [t.srcFactorId, t.dstFactorId] }),
    check("factor_rel_direction_chk", sql`${t.direction} in (-1, 1)`),
    check("factor_rel_strength_chk", sql`${t.strength} between 0 and 1`),
  ],
);

export const companyFactorExposures = pgTable(
  "company_factor_exposures",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    factorId: integer("factor_id")
      .notNull()
      .references(() => factors.id, { onDelete: "cascade" }),
    magnitude: smallint("magnitude").notNull(),
    direction: smallint("direction").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    rationale: text("rationale"),
    evidenceUrls: jsonb("evidence_urls")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    source: exposureSource("source").notNull(),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
  },
  (t) => [
    check("exposure_magnitude_chk", sql`${t.magnitude} between 0 and 3`),
    check("exposure_direction_chk", sql`${t.direction} in (-1, 0, 1)`),
    check("exposure_confidence_chk", sql`${t.confidence} between 0 and 1`),
    check("exposure_zero_direction_chk", sql`(${t.magnitude} = 0) = (${t.direction} = 0)`),
    // At most one current (open-ended) row per company/factor.
    uniqueIndex("exposure_current_idx")
      .on(t.companyId, t.factorId)
      .where(sql`${t.validTo} is null`),
    index("exposure_factor_idx").on(t.factorId),
  ],
);
