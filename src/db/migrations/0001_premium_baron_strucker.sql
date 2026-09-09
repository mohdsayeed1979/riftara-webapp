ALTER TABLE "maintenance_assets" ADD COLUMN "useful_life_years" integer;--> statement-breakpoint
ALTER TABLE "maintenance_assets" ADD COLUMN "residual_value" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "maintenance_assets" ADD COLUMN "depreciation_method" varchar(24) DEFAULT 'straight_line';