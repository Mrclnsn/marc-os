CREATE TYPE "public"."source_kind" AS ENUM('article', 'video', 'podcast', 'book', 'course', 'idea', 'link');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('new', 'read', 'processed');--> statement-breakpoint
CREATE TABLE "links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_kind" text NOT NULL,
	"from_id" uuid NOT NULL,
	"target_kind" text,
	"target_key" text NOT NULL,
	"label" text NOT NULL,
	"context" text,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"kind" "source_kind" DEFAULT 'link' NOT NULL,
	"status" "source_status" DEFAULT 'new' NOT NULL,
	"author" text,
	"summary" text,
	"body" text,
	"area" "area",
	"client_id" uuid,
	"project_id" uuid,
	"captured_via" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "links_from_idx" ON "links" USING btree ("from_kind","from_id");--> statement-breakpoint
CREATE INDEX "links_target_idx" ON "links" USING btree ("target_key");--> statement-breakpoint
CREATE INDEX "sources_status_idx" ON "sources" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sources_client_idx" ON "sources" USING btree ("client_id");