CREATE TYPE "public"."approval_status" AS ENUM('draft', 'pending', 'approved', 'rejected', 'returned', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('create', 'update', 'delete', 'soft_delete', 'restore', 'approve', 'reject', 'publish', 'unpublish', 'login', 'login_failed', 'logout', 'export', 'import', 'sign', 'allocate', 'sync');--> statement-breakpoint
CREATE TYPE "public"."collection_action_type" AS ENUM('reminder', 'follow_up', 'escalation', 'formal_notice', 'legal_review', 'payment_plan', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('draft', 'pending_approval', 'issued', 'signed', 'active', 'expired', 'terminated', 'renewal_pending');--> statement-breakpoint
CREATE TYPE "public"."customer_type" AS ENUM('individual', 'corporate');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('not_connected', 'configuration_required', 'connected', 'error');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('upcoming', 'due', 'paid', 'partially_paid', 'overdue', 'cancelled', 'waived');--> statement-breakpoint
CREATE TYPE "public"."maintenance_type" AS ENUM('preventive', 'corrective', 'emergency', 'inspection', 'renovation', 'unit_turnaround');--> statement-breakpoint
CREATE TYPE "public"."owner_type" AS ENUM('individual', 'entity');--> statement-breakpoint
CREATE TYPE "public"."payment_frequency" AS ENUM('monthly', 'quarterly', 'semi_annual', 'annual', 'custom');--> statement-breakpoint
CREATE TYPE "public"."priority_level" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('draft', 'pending_approval', 'approved', 'sent', 'accepted', 'rejected', 'expired', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."publication_state" AS ENUM('unpublished', 'published', 'featured');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('pending', 'active', 'converted', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."viewing_status" AS ENUM('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show', 'rescheduled');--> statement-breakpoint
CREATE TYPE "public"."work_order_status" AS ENUM('open', 'assigned', 'in_progress', 'pending', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"prefix" varchar(16) NOT NULL,
	"key_hash" varchar(128) NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 120 NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"actor_label" varchar(160),
	"action" "audit_action" NOT NULL,
	"entity_type" varchar(64) NOT NULL,
	"entity_id" uuid,
	"entity_label" varchar(200),
	"previous_value" jsonb,
	"new_value" jsonb,
	"changed_fields" jsonb,
	"reason" text,
	"approval_reference" varchar(64),
	"ip_address" varchar(64),
	"device" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(160) NOT NULL,
	"successful" boolean NOT NULL,
	"ip_address" varchar(64),
	"user_agent" text,
	"reason" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"name_en" varchar(200) NOT NULL,
	"name_ar" varchar(200),
	"legal_name" varchar(200),
	"commercial_registration" varchar(40),
	"vat_number" varchar(40),
	"default_currency" varchar(3) DEFAULT 'SAR' NOT NULL,
	"default_locale" varchar(5) DEFAULT 'en' NOT NULL,
	"timezone" varchar(64) DEFAULT 'Asia/Riyadh' NOT NULL,
	"vat_rate_bps" integer DEFAULT 1500 NOT NULL,
	"logo_url" text,
	"address_line" text,
	"phone" varchar(32),
	"email" varchar(160),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "organizations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(96) NOT NULL,
	"module" varchar(48) NOT NULL,
	"action" varchar(48) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_uq" UNIQUE("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" varchar(64) NOT NULL,
	"name_en" varchar(120) NOT NULL,
	"name_ar" varchar(120),
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "roles_org_key_uq" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"ip_address" varchar(64),
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_uq" UNIQUE("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "user_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scope_type" varchar(24) NOT NULL,
	"scope_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_scopes_uq" UNIQUE("user_id","scope_type","scope_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" varchar(160) NOT NULL,
	"password_hash" text,
	"full_name" varchar(160) NOT NULL,
	"full_name_ar" varchar(160),
	"job_title" varchar(120),
	"phone" varchar(32),
	"avatar_url" text,
	"locale" varchar(5) DEFAULT 'en' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"external_auth_id" varchar(128),
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_org_email_uq" UNIQUE("organization_id","email")
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"region_id" uuid,
	"code" varchar(32) NOT NULL,
	"name_en" varchar(160) NOT NULL,
	"name_ar" varchar(160),
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"is_active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "cities_org_code_uq" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "districts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"name_en" varchar(160) NOT NULL,
	"name_ar" varchar(160),
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"is_active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "districts_org_code_uq" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"name_en" varchar(160) NOT NULL,
	"name_ar" varchar(160),
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "portfolios_org_code_uq" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"name_en" varchar(160) NOT NULL,
	"name_ar" varchar(160),
	"is_active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "regions_org_code_uq" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "document_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" varchar(64) NOT NULL,
	"name_en" varchar(120) NOT NULL,
	"name_ar" varchar(120),
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"applies_to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requires_expiry" boolean DEFAULT false NOT NULL,
	"expiry_warning_days" integer DEFAULT 30 NOT NULL,
	CONSTRAINT "document_categories_org_key_uq" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" varchar(64) NOT NULL,
	"name_en" varchar(120) NOT NULL,
	"name_ar" varchar(120),
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"included_in_opex" boolean DEFAULT true NOT NULL,
	"is_recoverable" boolean DEFAULT false NOT NULL,
	CONSTRAINT "expense_categories_org_key_uq" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "lead_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" varchar(64) NOT NULL,
	"name_en" varchar(120) NOT NULL,
	"name_ar" varchar(120),
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"channel" varchar(32) DEFAULT 'digital' NOT NULL,
	"marketing_platform_key" varchar(48),
	CONSTRAINT "lead_sources_org_key_uq" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "lead_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" varchar(64) NOT NULL,
	"name_en" varchar(120) NOT NULL,
	"name_ar" varchar(120),
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"pipeline_order" integer DEFAULT 0 NOT NULL,
	"stage_type" varchar(16) DEFAULT 'open' NOT NULL,
	"color_token" varchar(32) DEFAULT 'info' NOT NULL,
	"requires_loss_reason" boolean DEFAULT false NOT NULL,
	"probability" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "lead_stages_org_key_uq" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "loss_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" varchar(64) NOT NULL,
	"name_en" varchar(120) NOT NULL,
	"name_ar" varchar(120),
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "loss_reasons_org_key_uq" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "maintenance_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" varchar(64) NOT NULL,
	"name_en" varchar(120) NOT NULL,
	"name_ar" varchar(120),
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"default_response_hours" integer DEFAULT 24 NOT NULL,
	"default_resolution_hours" integer DEFAULT 72 NOT NULL,
	CONSTRAINT "maintenance_categories_org_key_uq" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "property_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" varchar(64) NOT NULL,
	"name_en" varchar(120) NOT NULL,
	"name_ar" varchar(120),
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"category" varchar(32) DEFAULT 'commercial' NOT NULL,
	"icon" varchar(48),
	CONSTRAINT "property_types_org_key_uq" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "unit_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" varchar(64) NOT NULL,
	"name_en" varchar(120) NOT NULL,
	"name_ar" varchar(120),
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"availability_class" varchar(24) DEFAULT 'not_available' NOT NULL,
	"color_token" varchar(32) DEFAULT 'neutral' NOT NULL,
	"publishable" boolean DEFAULT false NOT NULL,
	"counts_as_occupied" boolean DEFAULT false NOT NULL,
	"blocks_leasing" boolean DEFAULT false NOT NULL,
	CONSTRAINT "unit_statuses_org_key_uq" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "unit_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" varchar(64) NOT NULL,
	"name_en" varchar(120) NOT NULL,
	"name_ar" varchar(120),
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"category" varchar(32) DEFAULT 'commercial' NOT NULL,
	CONSTRAINT "unit_types_org_key_uq" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"name_en" varchar(160) NOT NULL,
	"name_ar" varchar(160),
	"commercial_registration" varchar(40),
	"vat_number" varchar(40),
	"contact_person" varchar(160),
	"phone" varchar(32),
	"email" varchar(160),
	"specialities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sla_compliance_percent" integer DEFAULT 0 NOT NULL,
	"rating_x10" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "vendors_org_code_uq" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"name_en" varchar(160) NOT NULL,
	"name_ar" varchar(160),
	"floor_count" integer DEFAULT 0 NOT NULL,
	"unit_count" integer DEFAULT 0 NOT NULL,
	"gross_leasable_area" numeric(14, 2),
	"construction_year" integer,
	"elevator_count" integer,
	"parking_capacity" integer,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "buildings_property_code_uq" UNIQUE("property_id","code")
);
--> statement-breakpoint
CREATE TABLE "floors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"name_en" varchar(120) NOT NULL,
	"name_ar" varchar(120),
	"gross_area" numeric(14, 2),
	"unit_count" integer DEFAULT 0 NOT NULL,
	"floor_plan_url" text,
	"floor_plan_layout" jsonb,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "floors_building_level_uq" UNIQUE("building_id","level")
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"field" varchar(48) NOT NULL,
	"previous_value" numeric(18, 2),
	"new_value" numeric(18, 2) NOT NULL,
	"effective_date" date NOT NULL,
	"changed_by_user_id" uuid,
	"reason" text,
	"approval_reference" varchar(64),
	"supporting_document_id" uuid,
	"market_reference" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reference" varchar(32) NOT NULL,
	"unit_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"customer_id" uuid,
	"proposal_id" uuid,
	"asking_price" numeric(18, 2) NOT NULL,
	"requested_price" numeric(18, 2) NOT NULL,
	"discount_amount" numeric(18, 2) NOT NULL,
	"discount_percent" numeric(9, 4) NOT NULL,
	"annual_impact" numeric(18, 2) NOT NULL,
	"contract_term_months" integer NOT NULL,
	"total_contract_value" numeric(18, 2) NOT NULL,
	"justification" text NOT NULL,
	"required_role_key" varchar(64) NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"requested_by_user_id" uuid,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "pricing_approvals_org_ref_uq" UNIQUE("organization_id","reference")
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"name_en" varchar(200) NOT NULL,
	"name_ar" varchar(200),
	"property_type_id" uuid NOT NULL,
	"usage" varchar(32) DEFAULT 'commercial' NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"portfolio_id" uuid,
	"region_id" uuid,
	"city_id" uuid NOT NULL,
	"district_id" uuid,
	"address_line" text,
	"national_address" varchar(64),
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"google_maps_reference" text,
	"cost_center" varchar(48),
	"property_manager_id" uuid,
	"leasing_manager_id" uuid,
	"asset_manager_id" uuid,
	"acquisition_date" date,
	"operational_start_date" date,
	"land_area" numeric(14, 2),
	"built_up_area" numeric(14, 2),
	"gross_leasable_area" numeric(14, 2),
	"net_leasable_area" numeric(14, 2),
	"common_area" numeric(14, 2),
	"parking_area" numeric(14, 2),
	"building_count" integer DEFAULT 0 NOT NULL,
	"floor_count" integer DEFAULT 0 NOT NULL,
	"unit_count" integer DEFAULT 0 NOT NULL,
	"construction_year" integer,
	"renovation_year" integer,
	"condition" varchar(32),
	"parking_capacity" integer,
	"elevator_count" integer,
	"hvac_type" varchar(64),
	"electrical_capacity" varchar(64),
	"water_infrastructure" varchar(64),
	"fire_fighting_system" boolean DEFAULT false NOT NULL,
	"fire_alarm_system" boolean DEFAULT false NOT NULL,
	"generator" boolean DEFAULT false NOT NULL,
	"building_management_system" boolean DEFAULT false NOT NULL,
	"cctv" boolean DEFAULT false NOT NULL,
	"access_control" boolean DEFAULT false NOT NULL,
	"loading_facilities" boolean DEFAULT false NOT NULL,
	"emergency_systems" boolean DEFAULT false NOT NULL,
	"amenities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description_en" text,
	"description_ar" text,
	"cover_image_url" text,
	"publication_state" "publication_state" DEFAULT 'unpublished' NOT NULL,
	"publish_price" boolean DEFAULT true NOT NULL,
	"publish_availability" boolean DEFAULT true NOT NULL,
	"first_published_at" timestamp with time zone,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "properties_org_code_uq" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "property_ownerships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"document_type" varchar(64) NOT NULL,
	"document_number" varchar(64) NOT NULL,
	"document_date" date,
	"issuing_authority" varchar(160),
	"document_id" uuid,
	"owner_type" "owner_type" NOT NULL,
	"owner_name" varchar(200) NOT NULL,
	"identification_type" varchar(48),
	"identification_number" varchar(64),
	"commercial_registration" varchar(40),
	"ownership_percentage" numeric(9, 4) DEFAULT 100 NOT NULL,
	"authorized_representative" varchar(160),
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "unit_pricing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"asking_rent" numeric(18, 2) DEFAULT 0 NOT NULL,
	"target_rent" numeric(18, 2),
	"minimum_rent" numeric(18, 2),
	"approved_rent" numeric(18, 2),
	"market_rent" numeric(18, 2),
	"previous_rent" numeric(18, 2),
	"rent_per_sqm" numeric(18, 2),
	"service_charges" numeric(18, 2) DEFAULT 0 NOT NULL,
	"deposit_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"utilities_charges" numeric(18, 2) DEFAULT 0 NOT NULL,
	"parking_charges" numeric(18, 2) DEFAULT 0 NOT NULL,
	"other_charges" numeric(18, 2) DEFAULT 0 NOT NULL,
	"vat_applicable" boolean DEFAULT true NOT NULL,
	"discount_percent" numeric(9, 4) DEFAULT 0 NOT NULL,
	"incentives" text,
	"rent_free_days" integer DEFAULT 0 NOT NULL,
	"fit_out_contribution" numeric(18, 2) DEFAULT 0 NOT NULL,
	"effective_from" date,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "unit_pricing_unit_id_unique" UNIQUE("unit_id")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"building_id" uuid,
	"floor_id" uuid,
	"code" varchar(40) NOT NULL,
	"unit_number" varchar(40) NOT NULL,
	"unit_type_id" uuid NOT NULL,
	"usage_type" varchar(32) DEFAULT 'commercial' NOT NULL,
	"status_id" uuid NOT NULL,
	"gross_area" numeric(14, 2),
	"net_area" numeric(14, 2),
	"leasable_area" numeric(14, 2),
	"terrace_area" numeric(14, 2),
	"balcony_area" numeric(14, 2),
	"storage_area" numeric(14, 2),
	"parking_allocation" integer DEFAULT 0 NOT NULL,
	"room_count" integer,
	"bedroom_count" integer,
	"bathroom_count" integer,
	"has_kitchen" boolean DEFAULT false NOT NULL,
	"has_maid_room" boolean DEFAULT false NOT NULL,
	"has_driver_room" boolean DEFAULT false NOT NULL,
	"furnishing_status" varchar(32) DEFAULT 'unfurnished' NOT NULL,
	"hvac_type" varchar(64),
	"electricity_meter_number" varchar(48),
	"water_meter_number" varchar(48),
	"electricity_account" varchar(48),
	"water_account" varchar(48),
	"condition" varchar(32),
	"availability_date" date,
	"computed_available_from" date,
	"computed_availability_class" varchar(24) DEFAULT 'not_available' NOT NULL,
	"availability_computed_at" timestamp with time zone,
	"frontage" numeric(8, 2),
	"ceiling_height" numeric(6, 2),
	"electrical_load" varchar(64),
	"permitted_activities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signage_rights" boolean DEFAULT false NOT NULL,
	"loading_access" boolean DEFAULT false NOT NULL,
	"delivery_access" boolean DEFAULT false NOT NULL,
	"fit_out_status" varchar(24) DEFAULT 'shell_core' NOT NULL,
	"fire_system" boolean DEFAULT false NOT NULL,
	"hvac_capacity" varchar(64),
	"utility_capacity" varchar(64),
	"fit_out_requirements" text,
	"description_en" text,
	"description_ar" text,
	"cover_image_url" text,
	"publication_state" "publication_state" DEFAULT 'unpublished' NOT NULL,
	"publish_price" boolean DEFAULT true NOT NULL,
	"publish_unit_number" boolean DEFAULT true NOT NULL,
	"publish_availability" boolean DEFAULT true NOT NULL,
	"contact_for_price" boolean DEFAULT false NOT NULL,
	"first_published_at" timestamp with time zone,
	"listed_at" timestamp with time zone,
	"vacancy_start_date" date,
	"last_leased_at" date,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "units_org_code_uq" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "customer_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"identifier_type" varchar(32) NOT NULL,
	"identifier_value" varchar(120) NOT NULL,
	"issuing_country" varchar(64),
	"expiry_date" date,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "customer_identifiers_uq" UNIQUE("organization_id","identifier_type","identifier_value")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"customer_type" "customer_type" DEFAULT 'individual' NOT NULL,
	"full_name_en" varchar(200) NOT NULL,
	"full_name_ar" varchar(200),
	"company_name" varchar(200),
	"mobile" varchar(32),
	"alternate_mobile" varchar(32),
	"email" varchar(160),
	"nationality" varchar(64),
	"employer" varchar(160),
	"monthly_income" numeric(18, 2),
	"business_activity" varchar(160),
	"unified_number" varchar(40),
	"vat_number" varchar(40),
	"authorized_representative" varchar(160),
	"address_line" text,
	"notes" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"priority" varchar(16) DEFAULT 'medium' NOT NULL,
	"owner_user_id" uuid,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"communication_consent" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "customers_org_code_uq" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "lead_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid,
	"customer_id" uuid,
	"activity_type" varchar(32) NOT NULL,
	"subject" varchar(200) NOT NULL,
	"body" text,
	"outcome" varchar(120),
	"direction" varchar(16) DEFAULT 'outbound' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_action" varchar(200),
	"next_follow_up_at" timestamp with time zone,
	"user_id" uuid,
	"metadata" jsonb,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"customer_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"source_id" uuid,
	"campaign_id" uuid,
	"requested_property_id" uuid,
	"requested_unit_id" uuid,
	"requested_unit_type_id" uuid,
	"required_area" numeric(14, 2),
	"budget_min" numeric(18, 2),
	"budget_max" numeric(18, 2),
	"move_in_date" date,
	"assigned_user_id" uuid,
	"assigned_at" timestamp with time zone,
	"qualification" varchar(24) DEFAULT 'unqualified' NOT NULL,
	"priority" "priority_level" DEFAULT 'medium' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"next_action" varchar(200),
	"next_follow_up_at" timestamp with time zone,
	"first_response_at" timestamp with time zone,
	"first_response_minutes" integer,
	"sla_breached" boolean DEFAULT false NOT NULL,
	"escalated_at" timestamp with time zone,
	"loss_reason_id" uuid,
	"loss_notes" text,
	"closed_at" timestamp with time zone,
	"landing_page" text,
	"device" varchar(32),
	"utm_source" varchar(120),
	"utm_medium" varchar(120),
	"utm_campaign" varchar(160),
	"utm_content" varchar(160),
	"utm_term" varchar(160),
	"click_id" varchar(160),
	"first_touch_source" varchar(120),
	"last_touch_source" varchar(120),
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "leads_org_code_uq" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reference" varchar(32) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"lead_id" uuid,
	"customer_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"leasable_area" numeric(14, 2) NOT NULL,
	"rent_per_sqm" numeric(18, 2) NOT NULL,
	"annual_rent" numeric(18, 2) NOT NULL,
	"vat_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"service_charges" numeric(18, 2) DEFAULT 0 NOT NULL,
	"deposit_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"contract_duration_months" integer NOT NULL,
	"payment_terms" varchar(120) DEFAULT 'quarterly' NOT NULL,
	"escalation_percent" numeric(9, 4) DEFAULT 0 NOT NULL,
	"grace_period_days" integer DEFAULT 0 NOT NULL,
	"fit_out_period_days" integer DEFAULT 0 NOT NULL,
	"parking_spaces" integer DEFAULT 0 NOT NULL,
	"utilities_terms" text,
	"special_terms" text,
	"total_contract_value" numeric(18, 2) NOT NULL,
	"status" "proposal_status" DEFAULT 'draft' NOT NULL,
	"pricing_approval_id" uuid,
	"valid_until" date,
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"document_id" uuid,
	"created_by_user_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "proposals_org_ref_version_uq" UNIQUE("organization_id","reference","version")
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"customer_id" uuid NOT NULL,
	"lead_id" uuid,
	"proposal_id" uuid,
	"property_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"reservation_date" date NOT NULL,
	"expiry_date" date NOT NULL,
	"reservation_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"payment_status" varchar(24) DEFAULT 'unpaid' NOT NULL,
	"terms" text,
	"status" "reservation_status" DEFAULT 'active' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"expired_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_by_user_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "reservations_org_code_uq" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"owner_user_id" uuid,
	"due_at" timestamp with time zone,
	"priority" "priority_level" DEFAULT 'medium' NOT NULL,
	"status" varchar(24) DEFAULT 'open' NOT NULL,
	"linked_entity_type" varchar(48),
	"linked_entity_id" uuid,
	"completed_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "viewing_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"viewing_id" uuid NOT NULL,
	"interest_level" integer,
	"price_suitability" integer,
	"area_suitability" integer,
	"location_suitability" integer,
	"unit_suitability" integer,
	"likelihood_to_lease" integer,
	"customer_comments" text,
	"agent_comments" text,
	"next_action" varchar(200),
	"recorded_by_user_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "viewing_feedback_viewing_id_unique" UNIQUE("viewing_id")
);
--> statement-breakpoint
CREATE TABLE "viewings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"lead_id" uuid,
	"customer_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"unit_id" uuid,
	"assigned_user_id" uuid,
	"meeting_point" varchar(200),
	"scheduled_date" date NOT NULL,
	"scheduled_time" time NOT NULL,
	"status" "viewing_status" DEFAULT 'scheduled' NOT NULL,
	"customer_confirmed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "viewings_org_code_uq" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "collection_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid,
	"invoice_id" uuid,
	"action_type" "collection_action_type" NOT NULL,
	"outstanding_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"days_overdue" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"outcome" varchar(160),
	"next_action_date" date,
	"performed_by_user_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_reason" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_versions_uq" UNIQUE("contract_id","version")
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contract_number" varchar(40) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"ejar_reference" varchar(64),
	"ejar_status" varchar(32) DEFAULT 'not_submitted' NOT NULL,
	"ejar_submitted_at" timestamp with time zone,
	"ejar_last_sync_at" timestamp with time zone,
	"ejar_error_message" text,
	"tenant_id" uuid NOT NULL,
	"lessor_name" varchar(200) NOT NULL,
	"property_id" uuid NOT NULL,
	"building_id" uuid,
	"unit_id" uuid NOT NULL,
	"reservation_id" uuid,
	"proposal_id" uuid,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"duration_months" integer NOT NULL,
	"leasable_area" numeric(14, 2),
	"annual_rent" numeric(18, 2) NOT NULL,
	"rent_per_sqm" numeric(18, 2),
	"payment_frequency" "payment_frequency" DEFAULT 'quarterly' NOT NULL,
	"deposit_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"vat_rate_bps" integer DEFAULT 1500 NOT NULL,
	"service_charges" numeric(18, 2) DEFAULT 0 NOT NULL,
	"escalation_percent" numeric(9, 4) DEFAULT 0 NOT NULL,
	"escalation_frequency_months" integer DEFAULT 12 NOT NULL,
	"grace_period_days" integer DEFAULT 0 NOT NULL,
	"fit_out_period_days" integer DEFAULT 0 NOT NULL,
	"special_conditions" text,
	"status" "contract_status" DEFAULT 'draft' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"signed_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"notice_date" date,
	"expected_vacate_date" date,
	"termination_reason" text,
	"terminated_at" timestamp with time zone,
	"renewal_status" varchar(32) DEFAULT 'not_started' NOT NULL,
	"renewed_from_contract_id" uuid,
	"renewal_probability" integer DEFAULT 50 NOT NULL,
	"proposed_renewal_rent" numeric(18, 2),
	"created_by_user_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "contracts_org_number_version_uq" UNIQUE("organization_id","contract_number","version")
);
--> statement-breakpoint
CREATE TABLE "handovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"handover_type" varchar(16) DEFAULT 'handover' NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"contract_signed" boolean DEFAULT false NOT NULL,
	"payment_received" boolean DEFAULT false NOT NULL,
	"deposit_received" boolean DEFAULT false NOT NULL,
	"unit_ready" boolean DEFAULT false NOT NULL,
	"keys_handed_over" integer DEFAULT 0 NOT NULL,
	"access_cards" integer DEFAULT 0 NOT NULL,
	"parking_cards" integer DEFAULT 0 NOT NULL,
	"electricity_meter_reading" varchar(32),
	"water_meter_reading" varchar(32),
	"unit_condition" varchar(64),
	"notes" text,
	"photo_document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tenant_signature" text,
	"company_signature" text,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_number" varchar(40) NOT NULL,
	"contract_id" uuid NOT NULL,
	"schedule_id" uuid,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date NOT NULL,
	"period_start" date,
	"period_end" date,
	"rent_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"service_charge_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"vat_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"other_charges_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"paid_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"balance_amount" numeric(18, 2) NOT NULL,
	"status" "invoice_status" DEFAULT 'upcoming' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"waived_at" timestamp with time zone,
	"waiver_reason" text,
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "invoices_org_number_uq" UNIQUE("organization_id","invoice_number")
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"allocation_method" varchar(16) DEFAULT 'automatic' NOT NULL,
	"reversed_at" timestamp with time zone,
	"allocated_by_user_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"installment_number" integer NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date NOT NULL,
	"rent_amount" numeric(18, 2) NOT NULL,
	"service_charge_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"vat_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"invoice_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "payment_schedules_contract_installment_uq" UNIQUE("contract_id","installment_number")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"payment_number" varchar(40) NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid,
	"property_id" uuid,
	"unit_id" uuid,
	"payment_date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"unallocated_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"method" varchar(32) DEFAULT 'bank_transfer' NOT NULL,
	"reference_number" varchar(80),
	"bank_name" varchar(120),
	"status" varchar(24) DEFAULT 'received' NOT NULL,
	"payment_type" varchar(24) DEFAULT 'rent' NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversal_reason" text,
	"notes" text,
	"recorded_by_user_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "payments_org_number_uq" UNIQUE("organization_id","payment_number")
);
--> statement-breakpoint
CREATE TABLE "renewals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"notice_due_date" date NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"current_rent" numeric(18, 2) NOT NULL,
	"proposed_rent" numeric(18, 2),
	"market_rent" numeric(18, 2),
	"agreed_rent" numeric(18, 2),
	"new_contract_id" uuid,
	"probability" integer DEFAULT 50 NOT NULL,
	"owner_user_id" uuid,
	"notes" text,
	"decided_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tenant_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid,
	"entry_date" date NOT NULL,
	"entry_type" varchar(24) NOT NULL,
	"description" varchar(240) NOT NULL,
	"debit_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"credit_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"running_balance" numeric(18, 2) NOT NULL,
	"invoice_id" uuid,
	"payment_id" uuid,
	"created_by_user_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"customer_id" uuid NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"display_name_ar" varchar(200),
	"industry" varchar(120),
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"onboarded_at" date,
	"account_manager_id" uuid,
	"credit_rating" varchar(16),
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tenants_org_code_uq" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"line_type" varchar(24) NOT NULL,
	"category_id" uuid,
	"period_month" integer NOT NULL,
	"budget_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "budget_lines_uq" UNIQUE("budget_id","line_type","period_month","category_id")
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"fiscal_year" integer NOT NULL,
	"property_id" uuid,
	"status" varchar(24) DEFAULT 'approved' NOT NULL,
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "maintenance_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" varchar(40) NOT NULL,
	"name_en" varchar(160) NOT NULL,
	"name_ar" varchar(160),
	"asset_type" varchar(40) NOT NULL,
	"property_id" uuid NOT NULL,
	"building_id" uuid,
	"location" varchar(160),
	"manufacturer" varchar(120),
	"model_number" varchar(80),
	"serial_number" varchar(80),
	"purchase_date" date,
	"purchase_cost" numeric(18, 2),
	"warranty_expiry_date" date,
	"supplier_vendor_id" uuid,
	"status" varchar(24) DEFAULT 'operational' NOT NULL,
	"lifetime_maintenance_cost" numeric(18, 2) DEFAULT 0 NOT NULL,
	"last_service_date" date,
	"next_service_date" date,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "maintenance_assets_org_code_uq" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "maintenance_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"unit_id" uuid,
	"asset_id" uuid,
	"vendor_id" uuid,
	"cost_type" varchar(24) DEFAULT 'vendor_invoice' NOT NULL,
	"description" varchar(240) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"vat_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"invoice_number" varchar(60),
	"incurred_on" date NOT NULL,
	"document_id" uuid,
	"recorded_by_user_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "operating_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reference" varchar(40) NOT NULL,
	"property_id" uuid NOT NULL,
	"building_id" uuid,
	"unit_id" uuid,
	"category_id" uuid NOT NULL,
	"vendor_id" uuid,
	"work_order_id" uuid,
	"description" varchar(240) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"vat_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"incurred_on" date NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"invoice_number" varchar(60),
	"document_id" uuid,
	"is_recoverable" boolean DEFAULT false NOT NULL,
	"recorded_by_user_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "operating_expenses_org_ref_uq" UNIQUE("organization_id","reference")
);
--> statement-breakpoint
CREATE TABLE "performance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope_type" varchar(24) NOT NULL,
	"scope_id" uuid,
	"snapshot_date" date NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"metrics" jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "performance_snapshots_uq" UNIQUE("scope_type","scope_id","snapshot_date")
);
--> statement-breakpoint
CREATE TABLE "preventive_maintenance_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name_en" varchar(160) NOT NULL,
	"property_id" uuid NOT NULL,
	"building_id" uuid,
	"unit_id" uuid,
	"asset_id" uuid,
	"category_id" uuid,
	"frequency" varchar(24) DEFAULT 'quarterly' NOT NULL,
	"interval_months" integer DEFAULT 3 NOT NULL,
	"next_due_date" date NOT NULL,
	"last_completed_date" date,
	"vendor_id" uuid,
	"estimated_cost" numeric(18, 2) DEFAULT 0 NOT NULL,
	"status" varchar(24) DEFAULT 'scheduled' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vacancy_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"vacancy_start_date" date NOT NULL,
	"first_publish_date" date,
	"listing_date" date,
	"lease_signed_date" date,
	"vacancy_end_date" date,
	"days_vacant" integer,
	"days_on_market" integer,
	"estimated_monthly_loss" numeric(18, 2) DEFAULT 0 NOT NULL,
	"estimated_total_loss" numeric(18, 2) DEFAULT 0 NOT NULL,
	"previous_contract_id" uuid,
	"leasable_area" numeric(14, 2),
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "valuations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"valuation_date" date NOT NULL,
	"acquisition_cost" numeric(18, 2),
	"book_value" numeric(18, 2),
	"market_value" numeric(18, 2) NOT NULL,
	"land_value" numeric(18, 2),
	"building_value" numeric(18, 2),
	"previous_market_value" numeric(18, 2),
	"change_amount" numeric(18, 2),
	"change_percent" numeric(9, 4),
	"valuation_company" varchar(160),
	"valuation_method" varchar(32),
	"cap_rate" numeric(9, 4),
	"report_document_id" uuid,
	"status" varchar(24) DEFAULT 'approved' NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"notes" text,
	"approved_by_user_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"maintenance_type" "maintenance_type" DEFAULT 'corrective' NOT NULL,
	"category_id" uuid,
	"property_id" uuid NOT NULL,
	"building_id" uuid,
	"unit_id" uuid,
	"asset_id" uuid,
	"tenant_id" uuid,
	"reported_by_customer_id" uuid,
	"priority" "priority_level" DEFAULT 'medium' NOT NULL,
	"status" "work_order_status" DEFAULT 'open' NOT NULL,
	"vendor_id" uuid,
	"assigned_user_id" uuid,
	"response_sla_hours" integer DEFAULT 24 NOT NULL,
	"resolution_sla_hours" integer DEFAULT 72 NOT NULL,
	"responded_at" timestamp with time zone,
	"actual_response_hours" integer,
	"completed_at" timestamp with time zone,
	"actual_resolution_hours" integer,
	"response_sla_met" boolean,
	"resolution_sla_met" boolean,
	"estimated_cost" numeric(18, 2) DEFAULT 0 NOT NULL,
	"actual_cost" numeric(18, 2) DEFAULT 0 NOT NULL,
	"resolution_notes" text,
	"cancelled_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "work_orders_org_code_uq" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "campaign_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"metric_date" date NOT NULL,
	"ad_group" varchar(160),
	"ad_id" varchar(120),
	"creative" varchar(200),
	"spend" numeric(18, 2) DEFAULT 0 NOT NULL,
	"impressions" bigint DEFAULT 0 NOT NULL,
	"reach" bigint DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"lead_count" integer DEFAULT 0 NOT NULL,
	"qualified_lead_count" integer DEFAULT 0 NOT NULL,
	"viewing_count" integer DEFAULT 0 NOT NULL,
	"proposal_count" integer DEFAULT 0 NOT NULL,
	"reservation_count" integer DEFAULT 0 NOT NULL,
	"contract_count" integer DEFAULT 0 NOT NULL,
	"contract_value" numeric(18, 2) DEFAULT 0 NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "campaign_metrics_uq" UNIQUE("campaign_id","metric_date","ad_id")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"platform_id" uuid NOT NULL,
	"external_campaign_id" varchar(120),
	"name" varchar(200) NOT NULL,
	"objective" varchar(64),
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"budget" numeric(18, 2) DEFAULT 0 NOT NULL,
	"portfolio_id" uuid,
	"city_id" uuid,
	"district_id" uuid,
	"property_id" uuid,
	"unit_id" uuid,
	"target_unit_type" varchar(64),
	"utm_campaign" varchar(160),
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"consent_type" varchar(32) NOT NULL,
	"granted" boolean NOT NULL,
	"channel" varchar(32),
	"source" varchar(120),
	"ip_address" varchar(64),
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_attributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"campaign_id" uuid,
	"platform_id" uuid,
	"touch_type" varchar(16) NOT NULL,
	"touched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"utm_source" varchar(120),
	"utm_medium" varchar(120),
	"utm_campaign" varchar(160),
	"utm_content" varchar(160),
	"utm_term" varchar(160),
	"click_id" varchar(160),
	"landing_page" text,
	"credit_bps" integer DEFAULT 10000 NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_platforms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" varchar(48) NOT NULL,
	"name" varchar(120) NOT NULL,
	"category" varchar(24) DEFAULT 'social' NOT NULL,
	"brand_color" varchar(16),
	"supports_lead_forms" boolean DEFAULT false NOT NULL,
	"supports_conversion_upload" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "marketing_platforms_org_key_uq" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "business_rule_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"rule_code" varchar(24) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"enforcement" varchar(16) DEFAULT 'enforced' NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "business_rule_configs_uq" UNIQUE("organization_id","rule_code")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"category_id" uuid,
	"entity_type" varchar(48) NOT NULL,
	"entity_id" uuid NOT NULL,
	"title" varchar(240) NOT NULL,
	"description" text,
	"file_name" varchar(260) NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" varchar(120) NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"is_current_version" boolean DEFAULT true NOT NULL,
	"expiry_date" date,
	"expiry_notified_at" timestamp with time zone,
	"required_permission" varchar(96),
	"is_confidential" boolean DEFAULT false NOT NULL,
	"uploaded_by_user_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity_type" varchar(48) NOT NULL,
	"file_name" varchar(260) NOT NULL,
	"status" varchar(24) DEFAULT 'uploaded' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"invalid_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"imported_rows" integer DEFAULT 0 NOT NULL,
	"created_entity_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"imported_at" timestamp with time zone,
	"rolled_back_at" timestamp with time zone,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"field" varchar(96),
	"error_code" varchar(48) NOT NULL,
	"message" text NOT NULL,
	"row_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_id" uuid NOT NULL,
	"operation" varchar(32) NOT NULL,
	"direction" varchar(16) DEFAULT 'outbound' NOT NULL,
	"result" varchar(16) NOT NULL,
	"http_status" integer,
	"duration_ms" integer,
	"entity_type" varchar(48),
	"entity_id" uuid,
	"request_summary" jsonb,
	"response_summary" jsonb,
	"error_message" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" varchar(48) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"category" varchar(32) NOT NULL,
	"status" "integration_status" DEFAULT 'not_connected' NOT NULL,
	"account_label" varchar(160),
	"system_of_record" varchar(48) DEFAULT 'riftara' NOT NULL,
	"required_env_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_successful_sync_at" timestamp with time zone,
	"failed_transaction_count" integer DEFAULT 0 NOT NULL,
	"last_error_message" text,
	"token_status" varchar(24) DEFAULT 'missing' NOT NULL,
	"token_expires_at" timestamp with time zone,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "integrations_org_key_uq" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "kpi_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" varchar(160) NOT NULL,
	"name_ar" varchar(160),
	"definition" text NOT NULL,
	"formula" text NOT NULL,
	"data_source" varchar(160) NOT NULL,
	"display_format" varchar(24) DEFAULT 'number' NOT NULL,
	"scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reporting_frequency" varchar(24) DEFAULT 'monthly' NOT NULL,
	"responsible_department" varchar(96),
	"higher_is_better" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "kpi_definitions_org_key_uq" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "kpi_thresholds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kpi_definition_id" uuid NOT NULL,
	"scope_type" varchar(24) DEFAULT 'portfolio' NOT NULL,
	"scope_id" uuid,
	"green_min_x100" integer,
	"amber_min_x100" integer,
	"red_max_x100" integer,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "kpi_thresholds_uq" UNIQUE("kpi_definition_id","scope_type","scope_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"required_permission" varchar(96),
	"notification_type" varchar(48) NOT NULL,
	"severity" varchar(16) DEFAULT 'info' NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text,
	"link_href" varchar(400),
	"entity_type" varchar(48),
	"entity_id" uuid,
	"read_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reference" varchar(40) NOT NULL,
	"report_type" varchar(64) NOT NULL,
	"title" varchar(240) NOT NULL,
	"scope_type" varchar(24) DEFAULT 'portfolio' NOT NULL,
	"scope_id" uuid,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"format" varchar(16) DEFAULT 'pdf' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"executive_commentary" text,
	"document_id" uuid,
	"storage_key" text,
	"generated_by_user_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_runs_org_ref_uq" UNIQUE("organization_id","reference")
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"module" varchar(48) NOT NULL,
	"name" varchar(160) NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"columns" jsonb,
	"sort_by" varchar(64),
	"sort_direction" varchar(8) DEFAULT 'desc' NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" varchar(96) NOT NULL,
	"group" varchar(48) DEFAULT 'general' NOT NULL,
	"value" jsonb NOT NULL,
	"label" varchar(200) NOT NULL,
	"description" text,
	"value_type" varchar(24) DEFAULT 'string' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "settings_org_key_uq" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"http_status" integer,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"target_url" text NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"secret_hash" varchar(128),
	"is_active" boolean DEFAULT true NOT NULL,
	"last_delivery_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "website_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"slug" varchar(200) NOT NULL,
	"payload" jsonb NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"available_from" date,
	"published_at" timestamp with time zone,
	"unpublished_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "website_listings_unit_id_unique" UNIQUE("unit_id"),
	CONSTRAINT "website_listings_slug_uq" UNIQUE("organization_id","slug")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_scopes" ADD CONSTRAINT "user_scopes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "districts" ADD CONSTRAINT "districts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "districts" ADD CONSTRAINT "districts_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_categories" ADD CONSTRAINT "document_categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stages" ADD CONSTRAINT "lead_stages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loss_reasons" ADD CONSTRAINT "loss_reasons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_categories" ADD CONSTRAINT "maintenance_categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_types" ADD CONSTRAINT "property_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_statuses" ADD CONSTRAINT "unit_statuses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_types" ADD CONSTRAINT "unit_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floors" ADD CONSTRAINT "floors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floors" ADD CONSTRAINT "floors_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_approvals" ADD CONSTRAINT "pricing_approvals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_approvals" ADD CONSTRAINT "pricing_approvals_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_approvals" ADD CONSTRAINT "pricing_approvals_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_approvals" ADD CONSTRAINT "pricing_approvals_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_approvals" ADD CONSTRAINT "pricing_approvals_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_property_type_id_property_types_id_fk" FOREIGN KEY ("property_type_id") REFERENCES "public"."property_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_property_manager_id_users_id_fk" FOREIGN KEY ("property_manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_leasing_manager_id_users_id_fk" FOREIGN KEY ("leasing_manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_asset_manager_id_users_id_fk" FOREIGN KEY ("asset_manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_ownerships" ADD CONSTRAINT "property_ownerships_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_pricing" ADD CONSTRAINT "unit_pricing_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_unit_type_id_unit_types_id_fk" FOREIGN KEY ("unit_type_id") REFERENCES "public"."unit_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_status_id_unit_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."unit_statuses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_identifiers" ADD CONSTRAINT "customer_identifiers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_identifiers" ADD CONSTRAINT "customer_identifiers_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_stage_id_lead_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."lead_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lead_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_requested_property_id_properties_id_fk" FOREIGN KEY ("requested_property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_requested_unit_id_units_id_fk" FOREIGN KEY ("requested_unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_requested_unit_type_id_unit_types_id_fk" FOREIGN KEY ("requested_unit_type_id") REFERENCES "public"."unit_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_loss_reason_id_loss_reasons_id_fk" FOREIGN KEY ("loss_reason_id") REFERENCES "public"."loss_reasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewing_feedback" ADD CONSTRAINT "viewing_feedback_viewing_id_viewings_id_fk" FOREIGN KEY ("viewing_id") REFERENCES "public"."viewings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewing_feedback" ADD CONSTRAINT "viewing_feedback_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_actions" ADD CONSTRAINT "collection_actions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_actions" ADD CONSTRAINT "collection_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_actions" ADD CONSTRAINT "collection_actions_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_actions" ADD CONSTRAINT "collection_actions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_actions" ADD CONSTRAINT "collection_actions_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_schedule_id_payment_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."payment_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_allocated_by_user_id_users_id_fk" FOREIGN KEY ("allocated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_schedules" ADD CONSTRAINT "payment_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_schedules" ADD CONSTRAINT "payment_schedules_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_ledger_entries" ADD CONSTRAINT "tenant_ledger_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_ledger_entries" ADD CONSTRAINT "tenant_ledger_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_ledger_entries" ADD CONSTRAINT "tenant_ledger_entries_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_ledger_entries" ADD CONSTRAINT "tenant_ledger_entries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_ledger_entries" ADD CONSTRAINT "tenant_ledger_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_ledger_entries" ADD CONSTRAINT "tenant_ledger_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_account_manager_id_users_id_fk" FOREIGN KEY ("account_manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_assets" ADD CONSTRAINT "maintenance_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_assets" ADD CONSTRAINT "maintenance_assets_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_assets" ADD CONSTRAINT "maintenance_assets_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_assets" ADD CONSTRAINT "maintenance_assets_supplier_vendor_id_vendors_id_fk" FOREIGN KEY ("supplier_vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_costs" ADD CONSTRAINT "maintenance_costs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_costs" ADD CONSTRAINT "maintenance_costs_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_costs" ADD CONSTRAINT "maintenance_costs_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_costs" ADD CONSTRAINT "maintenance_costs_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_costs" ADD CONSTRAINT "maintenance_costs_asset_id_maintenance_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."maintenance_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_costs" ADD CONSTRAINT "maintenance_costs_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_costs" ADD CONSTRAINT "maintenance_costs_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_snapshots" ADD CONSTRAINT "performance_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preventive_maintenance_schedules" ADD CONSTRAINT "preventive_maintenance_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preventive_maintenance_schedules" ADD CONSTRAINT "preventive_maintenance_schedules_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preventive_maintenance_schedules" ADD CONSTRAINT "preventive_maintenance_schedules_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preventive_maintenance_schedules" ADD CONSTRAINT "preventive_maintenance_schedules_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preventive_maintenance_schedules" ADD CONSTRAINT "preventive_maintenance_schedules_asset_id_maintenance_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."maintenance_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preventive_maintenance_schedules" ADD CONSTRAINT "preventive_maintenance_schedules_category_id_maintenance_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."maintenance_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preventive_maintenance_schedules" ADD CONSTRAINT "preventive_maintenance_schedules_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy_periods" ADD CONSTRAINT "vacancy_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy_periods" ADD CONSTRAINT "vacancy_periods_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy_periods" ADD CONSTRAINT "vacancy_periods_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy_periods" ADD CONSTRAINT "vacancy_periods_previous_contract_id_contracts_id_fk" FOREIGN KEY ("previous_contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_category_id_maintenance_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."maintenance_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_asset_id_maintenance_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."maintenance_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_reported_by_customer_id_customers_id_fk" FOREIGN KEY ("reported_by_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_metrics" ADD CONSTRAINT "campaign_metrics_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_platform_id_marketing_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."marketing_platforms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_attributions" ADD CONSTRAINT "marketing_attributions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_attributions" ADD CONSTRAINT "marketing_attributions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_attributions" ADD CONSTRAINT "marketing_attributions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_attributions" ADD CONSTRAINT "marketing_attributions_platform_id_marketing_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."marketing_platforms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_platforms" ADD CONSTRAINT "marketing_platforms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_rule_configs" ADD CONSTRAINT "business_rule_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_category_id_document_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."document_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_logs" ADD CONSTRAINT "integration_logs_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_definitions" ADD CONSTRAINT "kpi_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_thresholds" ADD CONSTRAINT "kpi_thresholds_kpi_definition_id_kpi_definitions_id_fk" FOREIGN KEY ("kpi_definition_id") REFERENCES "public"."kpi_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_thresholds" ADD CONSTRAINT "kpi_thresholds_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_listings" ADD CONSTRAINT "website_listings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "login_attempts_email_idx" ON "login_attempts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "login_attempts_created_idx" ON "login_attempts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "permissions_module_idx" ON "permissions" USING btree ("module");--> statement-breakpoint
CREATE INDEX "role_permissions_role_idx" ON "role_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "user_roles_user_idx" ON "user_roles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_scopes_user_idx" ON "user_scopes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "cities_region_idx" ON "cities" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "districts_city_idx" ON "districts" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "vendors_org_idx" ON "vendors" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "buildings_property_idx" ON "buildings" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "floors_building_idx" ON "floors" USING btree ("building_id");--> statement-breakpoint
CREATE INDEX "price_history_unit_idx" ON "price_history" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "price_history_created_idx" ON "price_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pricing_approvals_status_idx" ON "pricing_approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pricing_approvals_unit_idx" ON "pricing_approvals" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "properties_org_idx" ON "properties" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "properties_city_idx" ON "properties" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "properties_district_idx" ON "properties" USING btree ("district_id");--> statement-breakpoint
CREATE INDEX "properties_type_idx" ON "properties" USING btree ("property_type_id");--> statement-breakpoint
CREATE INDEX "properties_status_idx" ON "properties" USING btree ("status");--> statement-breakpoint
CREATE INDEX "properties_name_idx" ON "properties" USING btree ("name_en");--> statement-breakpoint
CREATE INDEX "properties_portfolio_idx" ON "properties" USING btree ("portfolio_id");--> statement-breakpoint
CREATE INDEX "property_ownerships_property_idx" ON "property_ownerships" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "property_ownerships_doc_idx" ON "property_ownerships" USING btree ("document_number");--> statement-breakpoint
CREATE INDEX "property_ownerships_cr_idx" ON "property_ownerships" USING btree ("commercial_registration");--> statement-breakpoint
CREATE INDEX "unit_pricing_unit_idx" ON "unit_pricing" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "units_property_idx" ON "units" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "units_building_idx" ON "units" USING btree ("building_id");--> statement-breakpoint
CREATE INDEX "units_floor_idx" ON "units" USING btree ("floor_id");--> statement-breakpoint
CREATE INDEX "units_status_idx" ON "units" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "units_availability_idx" ON "units" USING btree ("computed_availability_class");--> statement-breakpoint
CREATE INDEX "units_type_idx" ON "units" USING btree ("unit_type_id");--> statement-breakpoint
CREATE INDEX "units_number_idx" ON "units" USING btree ("unit_number");--> statement-breakpoint
CREATE INDEX "units_publication_idx" ON "units" USING btree ("publication_state");--> statement-breakpoint
CREATE INDEX "customer_identifiers_customer_idx" ON "customer_identifiers" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_identifiers_value_idx" ON "customer_identifiers" USING btree ("identifier_value");--> statement-breakpoint
CREATE INDEX "customers_mobile_idx" ON "customers" USING btree ("mobile");--> statement-breakpoint
CREATE INDEX "customers_email_idx" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "customers_org_idx" ON "customers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "customers_name_idx" ON "customers" USING btree ("full_name_en");--> statement-breakpoint
CREATE INDEX "lead_activities_lead_idx" ON "lead_activities" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_activities_customer_idx" ON "lead_activities" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "lead_activities_occurred_idx" ON "lead_activities" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "leads_stage_idx" ON "leads" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "leads_customer_idx" ON "leads" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "leads_assigned_idx" ON "leads" USING btree ("assigned_user_id");--> statement-breakpoint
CREATE INDEX "leads_org_created_idx" ON "leads" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_followup_idx" ON "leads" USING btree ("next_follow_up_at");--> statement-breakpoint
CREATE INDEX "leads_property_idx" ON "leads" USING btree ("requested_property_id");--> statement-breakpoint
CREATE INDEX "leads_source_idx" ON "leads" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "proposals_customer_idx" ON "proposals" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "proposals_unit_idx" ON "proposals" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "proposals_status_idx" ON "proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reservations_unit_idx" ON "reservations" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "reservations_customer_idx" ON "reservations" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "reservations_status_idx" ON "reservations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reservations_expiry_idx" ON "reservations" USING btree ("expiry_date");--> statement-breakpoint
CREATE INDEX "tasks_owner_idx" ON "tasks" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "viewing_feedback_viewing_idx" ON "viewing_feedback" USING btree ("viewing_id");--> statement-breakpoint
CREATE INDEX "viewings_customer_idx" ON "viewings" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "viewings_unit_idx" ON "viewings" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "viewings_date_idx" ON "viewings" USING btree ("scheduled_date");--> statement-breakpoint
CREATE INDEX "viewings_status_idx" ON "viewings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "collection_actions_tenant_idx" ON "collection_actions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "collection_actions_invoice_idx" ON "collection_actions" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "collection_actions_created_idx" ON "collection_actions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "contract_versions_contract_idx" ON "contract_versions" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "contracts_unit_idx" ON "contracts" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "contracts_tenant_idx" ON "contracts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "contracts_property_idx" ON "contracts" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "contracts_status_idx" ON "contracts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contracts_dates_idx" ON "contracts" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE INDEX "contracts_end_date_idx" ON "contracts" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX "handovers_contract_idx" ON "handovers" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "handovers_unit_idx" ON "handovers" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "invoices_contract_idx" ON "invoices" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "invoices_tenant_idx" ON "invoices" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "invoices_property_idx" ON "invoices" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "invoices_unit_idx" ON "invoices" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "invoices_due_idx" ON "invoices" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoices_org_status_due_idx" ON "invoices" USING btree ("organization_id","status","due_date");--> statement-breakpoint
CREATE INDEX "payment_allocations_payment_idx" ON "payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_invoice_idx" ON "payment_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payment_schedules_contract_idx" ON "payment_schedules" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "payment_schedules_due_idx" ON "payment_schedules" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "payments_tenant_idx" ON "payments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payments_contract_idx" ON "payments" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "payments_property_idx" ON "payments" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "payments_date_idx" ON "payments" USING btree ("payment_date");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "renewals_contract_idx" ON "renewals" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "renewals_status_idx" ON "renewals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "renewals_notice_idx" ON "renewals" USING btree ("notice_due_date");--> statement-breakpoint
CREATE INDEX "tenant_ledger_tenant_idx" ON "tenant_ledger_entries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_ledger_date_idx" ON "tenant_ledger_entries" USING btree ("entry_date");--> statement-breakpoint
CREATE INDEX "tenant_ledger_contract_idx" ON "tenant_ledger_entries" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "tenants_customer_idx" ON "tenants" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "tenants_org_idx" ON "tenants" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "budget_lines_budget_idx" ON "budget_lines" USING btree ("budget_id");--> statement-breakpoint
CREATE INDEX "budgets_property_idx" ON "budgets" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "budgets_year_idx" ON "budgets" USING btree ("fiscal_year");--> statement-breakpoint
CREATE INDEX "maintenance_assets_property_idx" ON "maintenance_assets" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "maintenance_assets_type_idx" ON "maintenance_assets" USING btree ("asset_type");--> statement-breakpoint
CREATE INDEX "maintenance_costs_work_order_idx" ON "maintenance_costs" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "maintenance_costs_property_idx" ON "maintenance_costs" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "maintenance_costs_incurred_idx" ON "maintenance_costs" USING btree ("incurred_on");--> statement-breakpoint
CREATE INDEX "operating_expenses_property_idx" ON "operating_expenses" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "operating_expenses_category_idx" ON "operating_expenses" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "operating_expenses_period_idx" ON "operating_expenses" USING btree ("period_year","period_month");--> statement-breakpoint
CREATE INDEX "operating_expenses_incurred_idx" ON "operating_expenses" USING btree ("incurred_on");--> statement-breakpoint
CREATE INDEX "performance_snapshots_scope_idx" ON "performance_snapshots" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "performance_snapshots_period_idx" ON "performance_snapshots" USING btree ("period_year","period_month");--> statement-breakpoint
CREATE INDEX "pm_schedules_property_idx" ON "preventive_maintenance_schedules" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "pm_schedules_due_idx" ON "preventive_maintenance_schedules" USING btree ("next_due_date");--> statement-breakpoint
CREATE INDEX "pm_schedules_asset_idx" ON "preventive_maintenance_schedules" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "vacancy_periods_unit_idx" ON "vacancy_periods" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "vacancy_periods_property_idx" ON "vacancy_periods" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "vacancy_periods_start_idx" ON "vacancy_periods" USING btree ("vacancy_start_date");--> statement-breakpoint
CREATE INDEX "valuations_property_idx" ON "valuations" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "valuations_date_idx" ON "valuations" USING btree ("valuation_date");--> statement-breakpoint
CREATE INDEX "valuations_current_idx" ON "valuations" USING btree ("property_id","is_current");--> statement-breakpoint
CREATE INDEX "work_orders_property_idx" ON "work_orders" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "work_orders_unit_idx" ON "work_orders" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "work_orders_status_idx" ON "work_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "work_orders_priority_idx" ON "work_orders" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "work_orders_created_idx" ON "work_orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "work_orders_vendor_idx" ON "work_orders" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "campaign_metrics_campaign_idx" ON "campaign_metrics" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_metrics_date_idx" ON "campaign_metrics" USING btree ("metric_date");--> statement-breakpoint
CREATE INDEX "campaigns_platform_idx" ON "campaigns" USING btree ("platform_id");--> statement-breakpoint
CREATE INDEX "campaigns_property_idx" ON "campaigns" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "campaigns_dates_idx" ON "campaigns" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE INDEX "consents_customer_idx" ON "consents" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "consents_type_idx" ON "consents" USING btree ("consent_type");--> statement-breakpoint
CREATE INDEX "marketing_attributions_lead_idx" ON "marketing_attributions" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "marketing_attributions_campaign_idx" ON "marketing_attributions" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "documents_entity_idx" ON "documents" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "documents_org_idx" ON "documents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "documents_expiry_idx" ON "documents" USING btree ("expiry_date");--> statement-breakpoint
CREATE INDEX "documents_category_idx" ON "documents" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "import_batches_org_idx" ON "import_batches" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "import_errors_batch_idx" ON "import_errors" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "integration_logs_integration_idx" ON "integration_logs" USING btree ("integration_id");--> statement-breakpoint
CREATE INDEX "integration_logs_created_idx" ON "integration_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "integration_logs_result_idx" ON "integration_logs" USING btree ("result");--> statement-breakpoint
CREATE INDEX "integrations_category_idx" ON "integrations" USING btree ("category");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_created_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_type_idx" ON "notifications" USING btree ("notification_type");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "report_runs_type_idx" ON "report_runs" USING btree ("report_type");--> statement-breakpoint
CREATE INDEX "report_runs_created_idx" ON "report_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "saved_views_user_module_idx" ON "saved_views" USING btree ("user_id","module");--> statement-breakpoint
CREATE INDEX "saved_views_org_module_idx" ON "saved_views" USING btree ("organization_id","module");--> statement-breakpoint
CREATE INDEX "settings_group_idx" ON "settings" USING btree ("group");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_webhook_idx" ON "webhook_deliveries" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "webhooks_org_idx" ON "webhooks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "website_listings_published_idx" ON "website_listings" USING btree ("is_published");--> statement-breakpoint
CREATE INDEX "website_listings_property_idx" ON "website_listings" USING btree ("property_id");