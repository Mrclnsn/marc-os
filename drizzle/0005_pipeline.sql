CREATE TYPE "public"."lead_status" AS ENUM('new', 'contact', 'quoted', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'accepted', 'rejected', 'expired');--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"company_name" text NOT NULL,
	"client_id" uuid,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"source" text,
	"interests" text[] DEFAULT '{}' NOT NULL,
	"estimated_value_cents" integer,
	"probability_pct" integer DEFAULT 50 NOT NULL,
	"next_step" text,
	"next_step_date" date,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"lost_reason" text,
	"closed_at" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"kind" "service_kind" NOT NULL,
	"description" text,
	"amount_cents" integer NOT NULL,
	"pricing" "pricing" NOT NULL,
	"period" "billing_period",
	"budget_cents" integer,
	"sessions_per_month" integer,
	"domain" text,
	"start_date" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"agreement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"client_id" uuid,
	"number" text NOT NULL,
	"title" text,
	"quote_date" date NOT NULL,
	"valid_until" date,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"sent_at" date,
	"decided_at" date,
	"url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_agreement_id_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_client_idx" ON "leads" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "leads_next_step_idx" ON "leads" USING btree ("next_step_date");--> statement-breakpoint
CREATE INDEX "quote_lines_quote_idx" ON "quote_lines" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quotes_lead_idx" ON "quotes" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "quotes_status_idx" ON "quotes" USING btree ("status");--> statement-breakpoint
-- Bestaande klanten met status "lead" krijgen een lead in de pipeline
INSERT INTO "leads" ("title", "company_name", "client_id", "source", "status")
SELECT 'Kennismaking', c."name", c."id", c."source", 'new' FROM "clients" c WHERE c."status" = 'lead';
