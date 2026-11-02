CREATE TABLE IF NOT EXISTS "research_decks" (
	"id" serial PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_decks" ADD CONSTRAINT "research_decks_thread_id_research_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."research_threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "research_decks_thread_idx" ON "research_decks" USING btree ("thread_id");