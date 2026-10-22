CREATE TABLE IF NOT EXISTS "experiment_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"participant_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "experiment_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arm" text NOT NULL,
	"experience" text NOT NULL,
	"consent_version" text NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "exp_participants_arm_chk" CHECK ("experiment_participants"."arm" in ('control', 'treatment')),
	CONSTRAINT "exp_participants_experience_chk" CHECK ("experiment_participants"."experience" in ('novice', 'intermediate', 'expert'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "experiment_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"participant_id" uuid NOT NULL,
	"phase" text NOT NULL,
	"perceived_diversification" smallint NOT NULL,
	"confidence" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exp_responses_phase_chk" CHECK ("experiment_responses"."phase" in ('pre', 'post')),
	CONSTRAINT "exp_responses_pd_chk" CHECK ("experiment_responses"."perceived_diversification" between 1 and 7),
	CONSTRAINT "exp_responses_conf_chk" CHECK ("experiment_responses"."confidence" between 1 and 7)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "experiment_submissions" (
	"participant_id" uuid PRIMARY KEY NOT NULL,
	"holdings" jsonb NOT NULL,
	"n_holdings" smallint NOT NULL,
	"factor_hhi" double precision NOT NULL,
	"effective_factors" double precision NOT NULL,
	"effective_sectors" double precision NOT NULL,
	"top_factor_share" double precision NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "experiment_events" ADD CONSTRAINT "experiment_events_participant_id_experiment_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."experiment_participants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "experiment_responses" ADD CONSTRAINT "experiment_responses_participant_id_experiment_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."experiment_participants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "experiment_submissions" ADD CONSTRAINT "experiment_submissions_participant_id_experiment_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."experiment_participants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exp_events_participant_idx" ON "experiment_events" USING btree ("participant_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exp_participants_stratum_idx" ON "experiment_participants" USING btree ("experience","arm");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "exp_responses_key_idx" ON "experiment_responses" USING btree ("participant_id","phase");