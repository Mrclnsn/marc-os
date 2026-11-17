CREATE TYPE "public"."document_kind" AS ENUM('quote', 'agreement', 'dpa', 'other');--> statement-breakpoint
CREATE TYPE "public"."dpa_status" AS ENUM('not_applicable', 'needed', 'sent', 'signed');--> statement-breakpoint
CREATE TABLE "client_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"email" text,
	"phone" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" "document_kind" DEFAULT 'other' NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"doc_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "websites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"registrar" text,
	"domain_expires_at" date,
	"hosting_location" text,
	"cms" text,
	"live_date" date,
	"hosting_by_us" boolean DEFAULT false NOT NULL,
	"maintenance_by_us" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "legal_form" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "client_since" date;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "kvk_number" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "vat_number" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "postcode" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "country" text DEFAULT 'NL' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "invoice_address" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "invoice_postcode" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "invoice_city" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "invoice_country" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "invoice_email" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "payment_term_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "moneybird_contact_id" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "dpa_status" "dpa_status" DEFAULT 'not_applicable' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "dpa_date" date;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "personal_data" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "vault_ref" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "websites" ADD CONSTRAINT "websites_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_contacts_client_idx" ON "client_contacts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_documents_client_idx" ON "client_documents" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "websites_client_idx" ON "websites" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "websites_expires_idx" ON "websites" USING btree ("domain_expires_at");