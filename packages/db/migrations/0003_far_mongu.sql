CREATE TABLE IF NOT EXISTS "company_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"alias" text NOT NULL,
	"kind" text DEFAULT 'name' NOT NULL,
	"ambiguous" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_aliases" ADD CONSTRAINT "company_aliases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_alias_idx" ON "company_aliases" USING btree ("company_id","alias");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_alias_text_idx" ON "company_aliases" USING btree ("alias");