CREATE TYPE "public"."news_class" AS ENUM('fundamental', 'narrative', 'noise', 'unclear');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"default_class" "news_class" NOT NULL,
	"definition" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "llm_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"status" text NOT NULL,
	"output_json" jsonb,
	"tokens_in" integer,
	"tokens_out" integer,
	"cache_read_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_runs_status_chk" CHECK ("llm_runs"."status" in ('ok', 'refusal', 'truncated', 'invalid'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "news_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"snippet" text,
	"body" text,
	"source_name" text,
	"published_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_hash" text NOT NULL,
	"cluster_id" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "news_classifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"event_type_id" integer,
	"class" "news_class" NOT NULL,
	"fundamental_importance" smallint NOT NULL,
	"market_relevance" smallint NOT NULL,
	"expected_persistence" smallint NOT NULL,
	"mechanism" text NOT NULL,
	"confidence" double precision NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"llm_run_id" integer,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_class_fi_chk" CHECK ("news_classifications"."fundamental_importance" between 0 and 10),
	CONSTRAINT "news_class_mr_chk" CHECK ("news_classifications"."market_relevance" between 0 and 10),
	CONSTRAINT "news_class_ep_chk" CHECK ("news_classifications"."expected_persistence" between 0 and 10),
	CONSTRAINT "news_class_conf_chk" CHECK ("news_classifications"."confidence" between 0 and 1)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "news_classifications" ADD CONSTRAINT "news_classifications_article_id_news_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."news_articles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "news_classifications" ADD CONSTRAINT "news_classifications_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "news_classifications" ADD CONSTRAINT "news_classifications_llm_run_id_llm_runs_id_fk" FOREIGN KEY ("llm_run_id") REFERENCES "public"."llm_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_types_slug_idx" ON "event_types" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "llm_runs_key_idx" ON "llm_runs" USING btree ("purpose","model","prompt_version","input_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "news_provider_id_idx" ON "news_articles" USING btree ("provider","provider_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_dedupe_idx" ON "news_articles" USING btree ("dedupe_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_published_idx" ON "news_articles" USING btree ("published_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "news_class_key_idx" ON "news_classifications" USING btree ("article_id","model","prompt_version","content_hash");