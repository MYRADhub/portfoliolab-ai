CREATE TABLE IF NOT EXISTS "research_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"mode" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_messages_role_chk" CHECK ("research_messages"."role" in ('user', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "research_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"title" text NOT NULL,
	"portfolio_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_messages" ADD CONSTRAINT "research_messages_thread_id_research_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."research_threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_threads" ADD CONSTRAINT "research_threads_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_threads" ADD CONSTRAINT "research_threads_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_messages_thread_idx" ON "research_messages" USING btree ("thread_id","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_threads_session_idx" ON "research_threads" USING btree ("session_id","updated_at");