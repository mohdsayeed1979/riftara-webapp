ALTER TYPE "public"."work_order_status" ADD VALUE 'draft';--> statement-breakpoint
ALTER TYPE "public"."work_order_status" ADD VALUE 'submitted';--> statement-breakpoint
ALTER TYPE "public"."work_order_status" ADD VALUE 'approved';--> statement-breakpoint
ALTER TYPE "public"."work_order_status" ADD VALUE 'on_hold';--> statement-breakpoint
ALTER TYPE "public"."work_order_status" ADD VALUE 'verified';--> statement-breakpoint
ALTER TYPE "public"."work_order_status" ADD VALUE 'closed';--> statement-breakpoint
CREATE TABLE "maintenance_checklist_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"name_en" varchar(160) NOT NULL,
	"name_ar" varchar(160),
	"category_id" uuid,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "maintenance_checklist_templates_org_code_uq" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "preventive_maintenance_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"occurrence_date" date NOT NULL,
	"work_order_id" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "pm_occurrences_schedule_date_uq" UNIQUE("schedule_id","occurrence_date")
);
--> statement-breakpoint
CREATE TABLE "work_order_checklist_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"item_key" varchar(64) NOT NULL,
	"item_label_en" varchar(200) NOT NULL,
	"result" varchar(8) NOT NULL,
	"notes" text,
	"document_id" uuid,
	"corrective_work_order_id" uuid,
	"completed_by_user_id" uuid,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "wo_checklist_results_item_uq" UNIQUE("work_order_id","template_id","item_key")
);
--> statement-breakpoint
ALTER TABLE "maintenance_costs" ADD COLUMN "quantity" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "maintenance_costs" ADD COLUMN "unit" varchar(24);--> statement-breakpoint
ALTER TABLE "maintenance_checklist_templates" ADD CONSTRAINT "maintenance_checklist_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_checklist_templates" ADD CONSTRAINT "maintenance_checklist_templates_category_id_maintenance_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."maintenance_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preventive_maintenance_occurrences" ADD CONSTRAINT "preventive_maintenance_occurrences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preventive_maintenance_occurrences" ADD CONSTRAINT "preventive_maintenance_occurrences_schedule_id_preventive_maintenance_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."preventive_maintenance_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preventive_maintenance_occurrences" ADD CONSTRAINT "preventive_maintenance_occurrences_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_checklist_results" ADD CONSTRAINT "work_order_checklist_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_checklist_results" ADD CONSTRAINT "work_order_checklist_results_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_checklist_results" ADD CONSTRAINT "work_order_checklist_results_template_id_maintenance_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."maintenance_checklist_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_checklist_results" ADD CONSTRAINT "work_order_checklist_results_corrective_work_order_id_work_orders_id_fk" FOREIGN KEY ("corrective_work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_checklist_results" ADD CONSTRAINT "work_order_checklist_results_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_checklist_templates_org_idx" ON "maintenance_checklist_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pm_occurrences_org_idx" ON "preventive_maintenance_occurrences" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "wo_checklist_results_wo_idx" ON "work_order_checklist_results" USING btree ("work_order_id");