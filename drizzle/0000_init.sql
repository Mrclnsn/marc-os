CREATE TYPE "public"."area" AS ENUM('zakelijk', 'prive');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('lead', 'active', 'on_hold', 'past');--> statement-breakpoint
CREATE TYPE "public"."note_type" AS ENUM('inbox', 'note', 'meeting', 'call', 'email', 'decision', 'info', 'idea');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('idea', 'planned', 'active', 'waiting', 'done', 'archived');--> statement-breakpoint
CREATE TYPE "public"."recurrence" AS ENUM('none', 'daily', 'weekdays', 'weekly', 'monthly', 'quarterly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."review_kind" AS ENUM('day', 'week', 'month');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('todo', 'doing', 'waiting', 'done');--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact_person" text,
	"email" text,
	"phone" text,
	"status" "client_status" DEFAULT 'active' NOT NULL,
	"info" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"type" "note_type" DEFAULT 'note' NOT NULL,
	"area" "area",
	"client_id" uuid,
	"project_id" uuid,
	"note_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"area" "area" DEFAULT 'zakelijk' NOT NULL,
	"client_id" uuid,
	"status" "project_status" DEFAULT 'planned' NOT NULL,
	"start_date" date,
	"due_date" date,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "review_kind" NOT NULL,
	"period_date" date NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"area" "area" DEFAULT 'zakelijk' NOT NULL,
	"client_id" uuid,
	"project_id" uuid,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"plan_date" date,
	"due_date" date,
	"priority" integer DEFAULT 2 NOT NULL,
	"estimate_min" integer,
	"recurrence" "recurrence" DEFAULT 'none' NOT NULL,
	"notes" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notes_type_idx" ON "notes" USING btree ("type");--> statement-breakpoint
CREATE INDEX "notes_client_idx" ON "notes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "projects_client_idx" ON "projects" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_plan_idx" ON "tasks" USING btree ("plan_date");--> statement-breakpoint
CREATE INDEX "tasks_client_idx" ON "tasks" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "tasks_project_idx" ON "tasks" USING btree ("project_id");