ALTER TABLE "company_factor_exposures" ADD COLUMN "evidence_quote" text;--> statement-breakpoint
ALTER TABLE "company_factor_exposures" ADD COLUMN "stability" double precision;--> statement-breakpoint
ALTER TABLE "company_factor_exposures" ADD CONSTRAINT "exposure_stability_chk" CHECK ("company_factor_exposures"."stability" is null or "company_factor_exposures"."stability" between 0 and 1);