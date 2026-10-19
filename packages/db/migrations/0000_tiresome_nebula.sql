CREATE TYPE "public"."exposure_source" AS ENUM('manual', 'llm_seeded', 'llm_updated');--> statement-breakpoint
CREATE TYPE "public"."factor_category" AS ENUM('macro', 'commodity', 'geography', 'supply_chain', 'theme', 'regulation', 'demand');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"exchange" text,
	"sector" text,
	"industry" text,
	"country" text,
	"market_cap" double precision,
	"active_from" date,
	"active_to" date
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "data_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_sources_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prices_daily" (
	"company_id" integer NOT NULL,
	"date" date NOT NULL,
	"open" double precision,
	"high" double precision,
	"low" double precision,
	"close" double precision NOT NULL,
	"adj_close" double precision NOT NULL,
	"volume" bigint,
	CONSTRAINT "prices_daily_company_id_date_pk" PRIMARY KEY("company_id","date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_factor_exposures" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"factor_id" integer NOT NULL,
	"magnitude" smallint NOT NULL,
	"direction" smallint NOT NULL,
	"confidence" double precision NOT NULL,
	"rationale" text,
	"evidence_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" "exposure_source" NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	CONSTRAINT "exposure_magnitude_chk" CHECK ("company_factor_exposures"."magnitude" between 0 and 3),
	CONSTRAINT "exposure_direction_chk" CHECK ("company_factor_exposures"."direction" in (-1, 0, 1)),
	CONSTRAINT "exposure_confidence_chk" CHECK ("company_factor_exposures"."confidence" between 0 and 1),
	CONSTRAINT "exposure_zero_direction_chk" CHECK (("company_factor_exposures"."magnitude" = 0) = ("company_factor_exposures"."direction" = 0))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "factor_relationships" (
	"src_factor_id" integer NOT NULL,
	"dst_factor_id" integer NOT NULL,
	"direction" smallint NOT NULL,
	"strength" double precision NOT NULL,
	"rationale" text,
	CONSTRAINT "factor_relationships_src_factor_id_dst_factor_id_pk" PRIMARY KEY("src_factor_id","dst_factor_id"),
	CONSTRAINT "factor_rel_direction_chk" CHECK ("factor_relationships"."direction" in (-1, 1)),
	CONSTRAINT "factor_rel_strength_chk" CHECK ("factor_relationships"."strength" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "factors" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" "factor_category" NOT NULL,
	"description" text NOT NULL,
	"rises_means" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "holdings" (
	"portfolio_id" uuid NOT NULL,
	"company_id" integer NOT NULL,
	"weight" double precision NOT NULL,
	"shares" double precision,
	"cost_basis" double precision,
	CONSTRAINT "holdings_portfolio_id_company_id_pk" PRIMARY KEY("portfolio_id","company_id"),
	CONSTRAINT "holdings_weight_chk" CHECK ("holdings"."weight" > 0 and "holdings"."weight" <= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"name" text NOT NULL,
	"base_currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prices_daily" ADD CONSTRAINT "prices_daily_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_factor_exposures" ADD CONSTRAINT "company_factor_exposures_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_factor_exposures" ADD CONSTRAINT "company_factor_exposures_factor_id_factors_id_fk" FOREIGN KEY ("factor_id") REFERENCES "public"."factors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "factor_relationships" ADD CONSTRAINT "factor_relationships_src_factor_id_factors_id_fk" FOREIGN KEY ("src_factor_id") REFERENCES "public"."factors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "factor_relationships" ADD CONSTRAINT "factor_relationships_dst_factor_id_factors_id_fk" FOREIGN KEY ("dst_factor_id") REFERENCES "public"."factors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "holdings" ADD CONSTRAINT "holdings_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "holdings" ADD CONSTRAINT "holdings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "companies_ticker_idx" ON "companies" USING btree ("ticker");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "exposure_current_idx" ON "company_factor_exposures" USING btree ("company_id","factor_id") WHERE "company_factor_exposures"."valid_to" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exposure_factor_idx" ON "company_factor_exposures" USING btree ("factor_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "factors_slug_idx" ON "factors" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portfolios_session_idx" ON "portfolios" USING btree ("session_id");