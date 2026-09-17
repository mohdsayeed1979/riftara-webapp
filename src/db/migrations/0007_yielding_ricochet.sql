ALTER TABLE "import_batches" ADD COLUMN "file_type" varchar(8);--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "mode" varchar(24) DEFAULT 'create_only' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "updated_rows" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "skipped_rows" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "warning_rows" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "error_summary" text;