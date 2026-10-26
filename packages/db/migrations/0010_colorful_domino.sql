ALTER TABLE "experiment_participants" ADD COLUMN "age_group" text DEFAULT 'adult' NOT NULL;--> statement-breakpoint
ALTER TABLE "experiment_participants" ADD COLUMN "pilot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "experiment_submissions" ADD COLUMN "effective_bets" double precision;--> statement-breakpoint
ALTER TABLE "experiment_participants" ADD CONSTRAINT "exp_participants_age_chk" CHECK ("experiment_participants"."age_group" in ('adult', 'minor'));