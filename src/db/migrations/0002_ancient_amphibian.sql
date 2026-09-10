CREATE TABLE "report_schedule_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"report_type" varchar(64) NOT NULL,
	"status" varchar(16) NOT NULL,
	"format" varchar(16) DEFAULT 'pdf' NOT NULL,
	"duration_ms" integer,
	"report_run_id" uuid,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"report_type" varchar(64) NOT NULL,
	"frequency" varchar(16) DEFAULT 'monthly' NOT NULL,
	"hour" integer DEFAULT 3 NOT NULL,
	"day_of_week" integer,
	"day_of_month" integer,
	"timezone" varchar(64) DEFAULT 'Asia/Riyadh' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"format" varchar(16) DEFAULT 'pdf' NOT NULL,
	"delivery_method" varchar(16) DEFAULT 'in_app' NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_status" varchar(16),
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "report_schedule_runs" ADD CONSTRAINT "report_schedule_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedule_runs" ADD CONSTRAINT "report_schedule_runs_schedule_id_report_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."report_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_schedule_runs_schedule_idx" ON "report_schedule_runs" USING btree ("schedule_id","created_at");--> statement-breakpoint
CREATE INDEX "report_schedule_runs_org_idx" ON "report_schedule_runs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "report_schedules_org_idx" ON "report_schedules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "report_schedules_due_idx" ON "report_schedules" USING btree ("is_active","next_run_at");