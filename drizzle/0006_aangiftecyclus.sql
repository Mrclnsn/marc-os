CREATE TYPE "public"."filing_extension" AS ENUM('none', 'individual', 'becon');--> statement-breakpoint
CREATE TYPE "public"."filing_kind" AS ENUM('vat', 'income_tax', 'corporate_tax', 'icp', 'payroll', 'other');--> statement-breakpoint
CREATE TYPE "public"."filing_status" AS ENUM('todo', 'waiting_docs', 'in_progress', 'review', 'filed', 'done');--> statement-breakpoint
CREATE TABLE "filing_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"agreement_id" uuid,
	"kind" "filing_kind" NOT NULL,
	"label" text,
	"frequency" "billing_period" NOT NULL,
	"extension" "filing_extension" DEFAULT 'none' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"docs_due_days" integer,
	"create_tasks" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "filings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"schedule_id" uuid,
	"kind" "filing_kind" NOT NULL,
	"label" text,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"deadline" date NOT NULL,
	"deadline_manual" boolean DEFAULT false NOT NULL,
	"docs_due_date" date,
	"docs_requested_at" date,
	"docs_received_at" date,
	"status" "filing_status" DEFAULT 'todo' NOT NULL,
	"filed_at" date,
	"done_at" date,
	"amount_cents" integer,
	"reference" text,
	"task_id" uuid,
	"task_created" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "filing_schedules" ADD CONSTRAINT "filing_schedules_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filing_schedules" ADD CONSTRAINT "filing_schedules_agreement_id_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filings" ADD CONSTRAINT "filings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filings" ADD CONSTRAINT "filings_schedule_id_filing_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."filing_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filings" ADD CONSTRAINT "filings_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "filing_schedules_client_idx" ON "filing_schedules" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "filings_client_idx" ON "filings" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "filings_deadline_idx" ON "filings" USING btree ("deadline");--> statement-breakpoint
CREATE INDEX "filings_status_idx" ON "filings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "filings_schedule_period_uq" ON "filings" USING btree ("schedule_id","period_start");--> statement-breakpoint
-- Bestaande lopende boekhoudafspraken krijgen standaard een aangiftecyclus (vanaf de huidige periode)
INSERT INTO "filing_schedules" ("client_id", "agreement_id", "kind", "frequency", "start_date")
SELECT a."client_id", a."id", 'vat', 'quarter', greatest(date_trunc('quarter', current_date)::date, coalesce(a."start_date", current_date))
FROM "agreements" a
WHERE a."kind" = 'bookkeeping' AND a."status" IN ('active', 'cancelled')
  AND NOT EXISTS (SELECT 1 FROM "filing_schedules" s WHERE s."client_id" = a."client_id");--> statement-breakpoint
INSERT INTO "filing_schedules" ("client_id", "agreement_id", "kind", "frequency", "start_date")
SELECT a."client_id", a."id",
  CASE WHEN lower(coalesce(c."legal_form", '')) IN ('bv', 'nv') THEN 'corporate_tax'::filing_kind ELSE 'income_tax'::filing_kind END,
  'year', greatest(date_trunc('year', current_date)::date, coalesce(a."start_date", current_date))
FROM "agreements" a JOIN "clients" c ON c."id" = a."client_id"
WHERE a."kind" = 'bookkeeping' AND a."status" IN ('active', 'cancelled')
  AND lower(coalesce(c."legal_form", '')) IN ('', 'eenmanszaak', 'vof', 'maatschap', 'bv', 'nv')
  AND NOT EXISTS (SELECT 1 FROM "filing_schedules" s WHERE s."client_id" = a."client_id" AND s."kind" IN ('income_tax', 'corporate_tax'));
