import {
  boolean,
  check,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** A person taking part in the study. No name, email or session link is stored: the id lives only in their cookie. */
export const experimentParticipants = pgTable(
  "experiment_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arm: text("arm").notNull(),
    experience: text("experience").notNull(),
    consentVersion: text("consent_version").notNull(),
    /** "adult" or "minor". No exact age is stored. Minors take part only with a guardian's consent. */
    ageGroup: text("age_group").notNull().default("adult"),
    /** Enrolled while the study ran in pilot mode. Pilot participants are left out of the main analysis. */
    pilot: boolean("pilot").notNull().default(false),
    consentedAt: timestamp("consented_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    check("exp_participants_arm_chk", sql`${t.arm} in ('control', 'treatment')`),
    check(
      "exp_participants_experience_chk",
      sql`${t.experience} in ('novice', 'intermediate', 'expert')`,
    ),
    check("exp_participants_age_chk", sql`${t.ageGroup} in ('adult', 'minor')`),
    index("exp_participants_stratum_idx").on(t.experience, t.arm),
  ],
);

export const experimentResponses = pgTable(
  "experiment_responses",
  {
    id: serial("id").primaryKey(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => experimentParticipants.id, { onDelete: "cascade" }),
    phase: text("phase").notNull(),
    perceivedDiversification: smallint("perceived_diversification").notNull(),
    confidence: smallint("confidence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("exp_responses_key_idx").on(t.participantId, t.phase),
    check("exp_responses_phase_chk", sql`${t.phase} in ('pre', 'post')`),
    check("exp_responses_pd_chk", sql`${t.perceivedDiversification} between 1 and 7`),
    check("exp_responses_conf_chk", sql`${t.confidence} between 1 and 7`),
  ],
);

export const experimentSubmissions = pgTable("experiment_submissions", {
  participantId: uuid("participant_id")
    .primaryKey()
    .references(() => experimentParticipants.id, { onDelete: "cascade" }),
  holdings: jsonb("holdings").notNull(),
  nHoldings: smallint("n_holdings").notNull(),
  /** Primary outcome (ADR 0004). */
  factorHhi: doublePrecision("factor_hhi").notNull(),
  effectiveFactors: doublePrecision("effective_factors").notNull(),
  effectiveSectors: doublePrecision("effective_sectors").notNull(),
  topFactorShare: doublePrecision("top_factor_share").notNull(),
  /** Robustness outcome from return covariance only (Meucci's effective number of bets). Null for older rows. */
  effectiveBets: doublePrecision("effective_bets"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const experimentEvents = pgTable(
  "experiment_events",
  {
    id: serial("id").primaryKey(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => experimentParticipants.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    type: text("type").notNull(),
    payload: jsonb("payload"),
  },
  (t) => [index("exp_events_participant_idx").on(t.participantId, t.at)],
);

export const EXPERIMENT_EVENT_TYPES = [
  "page_visible",
  "page_hidden",
  "view_universe",
  "add_holding",
  "remove_holding",
  "set_weight",
  "preview",
  "submit_attempt",
] as const;
