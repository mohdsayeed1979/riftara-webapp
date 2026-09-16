CREATE TABLE "erp_entity_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"system" varchar(48) NOT NULL,
	"entity_type" varchar(48) NOT NULL,
	"local_entity_id" uuid NOT NULL,
	"external_entity_id" varchar(160),
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "erp_entity_mappings_local_uq" UNIQUE("organization_id","system","entity_type","local_entity_id")
);
--> statement-breakpoint
CREATE TABLE "erp_integration_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"system" varchar(48) DEFAULT 'dynamics_ax2012' NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"entity_type" varchar(48) NOT NULL,
	"entity_id" uuid NOT NULL,
	"idempotency_key" varchar(240) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	"error_code" varchar(48),
	"error_message" text,
	"external_reference" varchar(160),
	"response_metadata" jsonb,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "erp_integration_events_idempotency_uq" UNIQUE("organization_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "erp_entity_mappings" ADD CONSTRAINT "erp_entity_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_integration_events" ADD CONSTRAINT "erp_integration_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "erp_entity_mappings_external_idx" ON "erp_entity_mappings" USING btree ("organization_id","system","entity_type","external_entity_id");--> statement-breakpoint
CREATE INDEX "erp_integration_events_status_idx" ON "erp_integration_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "erp_integration_events_retry_idx" ON "erp_integration_events" USING btree ("next_retry_at");--> statement-breakpoint
CREATE INDEX "erp_integration_events_entity_idx" ON "erp_integration_events" USING btree ("entity_type","entity_id");