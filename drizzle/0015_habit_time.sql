ALTER TABLE "habits" ADD COLUMN "time" text;--> statement-breakpoint
ALTER TABLE "habits" ADD COLUMN "moment" text;--> statement-breakpoint
ALTER TABLE "habits" ADD COLUMN "remind" boolean DEFAULT false NOT NULL;