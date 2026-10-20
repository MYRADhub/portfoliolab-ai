CREATE TABLE IF NOT EXISTS "ingest_failures" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"error" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "news_company_links" (
	"article_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"method" text NOT NULL,
	"score" double precision DEFAULT 1 NOT NULL,
	CONSTRAINT "news_company_links_article_id_company_id_method_pk" PRIMARY KEY("article_id","company_id","method"),
	CONSTRAINT "news_links_score_chk" CHECK ("news_company_links"."score" between 0 and 1)
);
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN "market_session" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "news_company_links" ADD CONSTRAINT "news_company_links_article_id_news_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."news_articles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "news_company_links" ADD CONSTRAINT "news_company_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_links_company_idx" ON "news_company_links" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "news_articles" ADD CONSTRAINT "news_session_chk" CHECK ("news_articles"."market_session" is null or "news_articles"."market_session" in ('pre', 'regular', 'after', 'closed'));