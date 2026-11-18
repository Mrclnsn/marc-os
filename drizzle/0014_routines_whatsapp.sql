CREATE TABLE "agent_routine_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"routine" text NOT NULL,
	"period" date NOT NULL,
	"trigger" text DEFAULT 'schedule' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"summary" text,
	"error" text,
	"review_id" uuid,
	"tools" jsonb,
	"proposal_ids" jsonb,
	"delivered" jsonb
);
--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD COLUMN "nr" serial NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_routine_runs_started_idx" ON "agent_routine_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_routine_runs_schedule_uq" ON "agent_routine_runs" USING btree ("routine","period") WHERE "agent_routine_runs"."trigger" = 'schedule';--> statement-breakpoint
CREATE UNIQUE INDEX "agent_proposals_nr_uq" ON "agent_proposals" USING btree ("nr");