CREATE TYPE "public"."agreement_status" AS ENUM('draft', 'active', 'cancelled', 'ended');--> statement-breakpoint
CREATE TYPE "public"."billing_period" AS ENUM('month', 'quarter', 'year');--> statement-breakpoint
CREATE TYPE "public"."installment_status" AS ENUM('planned', 'ready', 'draft', 'sent', 'paid');--> statement-breakpoint
CREATE TYPE "public"."installment_trigger" AS ENUM('date', 'acceptance', 'delivery');--> statement-breakpoint
CREATE TYPE "public"."pricing" AS ENUM('recurring', 'one_off', 'hourly');--> statement-breakpoint
CREATE TYPE "public"."service_kind" AS ENUM('bookkeeping', 'website', 'hosting', 'maintenance', 'sparring', 'custom');--> statement-breakpoint
CREATE TABLE "agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" "service_kind" NOT NULL,
	"title" text,
	"website_id" uuid,
	"project_id" uuid,
	"amount_cents" integer NOT NULL,
	"pricing" "pricing" NOT NULL,
	"period" "billing_period",
	"budget_cents" integer,
	"sessions_per_month" integer,
	"start_date" date,
	"end_date" date,
	"notice_months" integer,
	"indexation_pct" numeric(5, 2),
	"status" "agreement_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"agreement_id" uuid,
	"project_id" uuid,
	"description" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"trigger" "installment_trigger" DEFAULT 'date' NOT NULL,
	"due_date" date,
	"status" "installment_status" DEFAULT 'planned' NOT NULL,
	"ready_at" date,
	"moneybird_invoice_id" text,
	"invoiced_at" date,
	"paid_at" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_website_id_websites_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."websites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_agreement_id_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agreements_client_idx" ON "agreements" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "agreements_status_idx" ON "agreements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "installments_client_idx" ON "installments" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "installments_agreement_idx" ON "installments" USING btree ("agreement_id");--> statement-breakpoint
CREATE INDEX "installments_status_idx" ON "installments" USING btree ("status");