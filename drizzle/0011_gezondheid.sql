CREATE TABLE "health_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"samples" integer DEFAULT 0 NOT NULL,
	"workouts" integer DEFAULT 0 NOT NULL,
	"sleep" integer DEFAULT 0 NOT NULL,
	"from_date" date,
	"to_date" date,
	"skipped" text[] DEFAULT '{}' NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "health_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metric" text NOT NULL,
	"date" date NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"qty" double precision NOT NULL,
	"unit" text NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_sleep" (
	"date" date PRIMARY KEY NOT NULL,
	"total_min" integer NOT NULL,
	"deep_min" integer,
	"rem_min" integer,
	"core_min" integer,
	"awake_min" integer,
	"in_bed_min" integer,
	"sleep_start" timestamp with time zone,
	"sleep_end" timestamp with time zone,
	"source" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_workouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text,
	"name" text NOT NULL,
	"kind" text DEFAULT 'overig' NOT NULL,
	"date" date NOT NULL,
	"start_at" timestamp with time zone,
	"duration_min" integer NOT NULL,
	"active_kcal" integer,
	"distance_km" double precision,
	"avg_hr" integer,
	"max_hr" integer,
	"source" text DEFAULT 'health' NOT NULL,
	"device" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "habits" ADD COLUMN "health_rule" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "health_samples_uq" ON "health_samples" USING btree ("metric","at");--> statement-breakpoint
CREATE INDEX "health_samples_date_idx" ON "health_samples" USING btree ("date","metric");--> statement-breakpoint
CREATE UNIQUE INDEX "health_workouts_external_uq" ON "health_workouts" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "health_workouts_date_idx" ON "health_workouts" USING btree ("date");