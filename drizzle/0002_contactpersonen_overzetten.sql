-- Bestaande contactpersoon, e-mail en telefoon worden de primaire contactpersoon van de klant
INSERT INTO "client_contacts" ("client_id", "name", "email", "phone", "is_primary")
SELECT "id", COALESCE(NULLIF(trim("contact_person"), ''), 'Contactpersoon'), NULLIF(trim("email"), ''), NULLIF(trim("phone"), ''), true
FROM "clients"
WHERE NULLIF(trim("contact_person"), '') IS NOT NULL OR NULLIF(trim("email"), '') IS NOT NULL OR NULLIF(trim("phone"), '') IS NOT NULL;--> statement-breakpoint
-- Het oude e-mailadres is ook het beste startpunt voor het factuur-e-mailadres
UPDATE "clients" SET "invoice_email" = NULLIF(trim("email"), '') WHERE "invoice_email" IS NULL;--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN "contact_person";--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN "phone";