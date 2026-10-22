CREATE TABLE IF NOT EXISTS "fundamentals" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"metric" text NOT NULL,
	"fiscal_year" smallint NOT NULL,
	"period_end" date NOT NULL,
	"value" double precision NOT NULL,
	"unit" text NOT NULL,
	"filed_at" date NOT NULL,
	"accession" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "cik" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fundamentals" ADD CONSTRAINT "fundamentals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fundamentals_key_idx" ON "fundamentals" USING btree ("company_id","metric","fiscal_year");