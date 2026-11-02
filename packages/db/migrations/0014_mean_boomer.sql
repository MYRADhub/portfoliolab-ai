CREATE TABLE IF NOT EXISTS "research_pins" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"portfolio_id" uuid,
	"message_id" integer NOT NULL,
	"display_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_decks" ALTER COLUMN "thread_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "research_decks" ADD COLUMN "notebook_key" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_pins" ADD CONSTRAINT "research_pins_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_pins" ADD CONSTRAINT "research_pins_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_pins" ADD CONSTRAINT "research_pins_message_id_research_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."research_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_pins_session_idx" ON "research_pins" USING btree ("session_id","portfolio_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "research_decks_notebook_idx" ON "research_decks" USING btree ("notebook_key");--> statement-breakpoint
ALTER TABLE "research_decks" ADD CONSTRAINT "research_decks_owner_chk" CHECK (("research_decks"."thread_id" is null) <> ("research_decks"."notebook_key" is null));