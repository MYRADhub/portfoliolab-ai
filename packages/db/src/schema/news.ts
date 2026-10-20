import {
  boolean,
  check,
  doublePrecision,
  index,
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
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./market";

export const newsClass = pgEnum("news_class", ["fundamental", "narrative", "noise", "unclear"]);

export const newsArticles = pgTable(
  "news_articles",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(),
    providerId: text("provider_id").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    snippet: text("snippet"),
    body: text("body"),
    sourceName: text("source_name"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
    /** Hash of the normalized title, for near-duplicate collapsing. */
    dedupeHash: text("dedupe_hash").notNull(),
    /** Id of the earliest article in this article's near-duplicate group (itself if unique). */
    clusterId: integer("cluster_id"),
    /** US equity session at publish time: pre, regular, after, closed. Determines the event day. */
    marketSession: text("market_session"),
  },
  (t) => [
    check(
      "news_session_chk",
      sql`${t.marketSession} is null or ${t.marketSession} in ('pre', 'regular', 'after', 'closed')`,
    ),
    uniqueIndex("news_provider_id_idx").on(t.provider, t.providerId),
    index("news_dedupe_idx").on(t.dedupeHash),
    index("news_published_idx").on(t.publishedAt),
  ],
);

export const eventTypes = pgTable(
  "event_types",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    defaultClass: newsClass("default_class").notNull(),
    definition: text("definition").notNull(),
  },
  (t) => [uniqueIndex("event_types_slug_idx").on(t.slug)],
);

/** Audit log and cache for every LLM call, keyed by what was asked. */
export const llmRuns = pgTable(
  "llm_runs",
  {
    id: serial("id").primaryKey(),
    purpose: text("purpose").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    inputHash: text("input_hash").notNull(),
    status: text("status").notNull(),
    outputJson: jsonb("output_json"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    cacheReadTokens: integer("cache_read_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("llm_runs_key_idx").on(t.purpose, t.model, t.promptVersion, t.inputHash),
    check("llm_runs_status_chk", sql`${t.status} in ('ok', 'refusal', 'truncated', 'invalid')`),
  ],
);

/** One row per (article, model, prompt version). Reclassifying inserts a new row, never overwrites. */
export const newsClassifications = pgTable(
  "news_classifications",
  {
    id: serial("id").primaryKey(),
    articleId: integer("article_id")
      .notNull()
      .references(() => newsArticles.id, { onDelete: "cascade" }),
    eventTypeId: integer("event_type_id").references(() => eventTypes.id),
    class: newsClass("class").notNull(),
    fundamentalImportance: smallint("fundamental_importance").notNull(),
    marketRelevance: smallint("market_relevance").notNull(),
    expectedPersistence: smallint("expected_persistence").notNull(),
    mechanism: text("mechanism").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    llmRunId: integer("llm_run_id").references(() => llmRuns.id),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("news_class_key_idx").on(t.articleId, t.model, t.promptVersion, t.contentHash),
    check("news_class_fi_chk", sql`${t.fundamentalImportance} between 0 and 10`),
    check("news_class_mr_chk", sql`${t.marketRelevance} between 0 and 10`),
    check("news_class_ep_chk", sql`${t.expectedPersistence} between 0 and 10`),
    check("news_class_conf_chk", sql`${t.confidence} between 0 and 1`),
  ],
);

export const newsCompanyLinks = pgTable(
  "news_company_links",
  {
    articleId: integer("article_id")
      .notNull()
      .references(() => newsArticles.id, { onDelete: "cascade" }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** provider_tag, alias, llm, exposure */
    method: text("method").notNull(),
    score: doublePrecision("score").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.articleId, t.companyId, t.method] }),
    index("news_links_company_idx").on(t.companyId),
    check("news_links_score_chk", sql`${t.score} between 0 and 1`),
  ],
);

/** Dead-letter record for items that could not be ingested, kept for inspection and replay. */
export const ingestFailures = pgTable("ingest_failures", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  subject: text("subject").notNull(),
  error: text("error").notNull(),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Names a company is known by in text. Matching is case-aware; ambiguous aliases score low on their own. */
export const companyAliases = pgTable(
  "company_aliases",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    /** name, product, executive */
    kind: text("kind").notNull().default("name"),
    /** True when the alias is also an everyday word or another entity (Target, Fox, Dow). */
    ambiguous: boolean("ambiguous").notNull().default(false),
  },
  (t) => [
    uniqueIndex("company_alias_idx").on(t.companyId, t.alias),
    index("company_alias_text_idx").on(t.alias),
  ],
);
