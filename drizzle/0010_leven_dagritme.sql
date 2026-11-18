CREATE TABLE "calendar_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_ok_at" timestamp with time zone,
	"last_error" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "habit_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"habit_id" uuid NOT NULL,
	"date" date NOT NULL,
	"source" text DEFAULT 'app' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "habits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"area" "area" DEFAULT 'prive' NOT NULL,
	"frequency" text DEFAULT 'daily' NOT NULL,
	"times_per_week" integer,
	"weekdays" integer[] DEFAULT '{}' NOT NULL,
	"block_id" uuid,
	"start_date" date NOT NULL,
	"archived_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rhythm_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rhythm_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'overig' NOT NULL,
	"area" "area",
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"remind" boolean DEFAULT false NOT NULL,
	"remind_before" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rhythm_overrides" (
	"date" date PRIMARY KEY NOT NULL,
	"rhythm_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rhythms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"weekdays" integer[] DEFAULT '{}' NOT NULL,
	"work_start" text,
	"work_end" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "plan_block_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "plan_time" text;--> statement-breakpoint
ALTER TABLE "habit_checks" ADD CONSTRAINT "habit_checks_habit_id_habits_id_fk" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habits" ADD CONSTRAINT "habits_block_id_rhythm_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."rhythm_blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rhythm_blocks" ADD CONSTRAINT "rhythm_blocks_rhythm_id_rhythms_id_fk" FOREIGN KEY ("rhythm_id") REFERENCES "public"."rhythms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rhythm_overrides" ADD CONSTRAINT "rhythm_overrides_rhythm_id_rhythms_id_fk" FOREIGN KEY ("rhythm_id") REFERENCES "public"."rhythms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "habit_checks_habit_date_uq" ON "habit_checks" USING btree ("habit_id","date");--> statement-breakpoint
CREATE INDEX "habit_checks_date_idx" ON "habit_checks" USING btree ("date");--> statement-breakpoint
CREATE INDEX "rhythm_blocks_rhythm_idx" ON "rhythm_blocks" USING btree ("rhythm_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_plan_block_id_rhythm_blocks_id_fk" FOREIGN KEY ("plan_block_id") REFERENCES "public"."rhythm_blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Startvulling: drie dagritmes, in de app aan te passen (Planning → Dagritme)
INSERT INTO "rhythms" ("name", "weekdays", "work_start", "work_end", "sort_order") VALUES
  ('Werkdag', '{1,2,3,4}', '08:45', '17:30', 1),
  ('Vrijdag', '{5}', '08:45', '16:00', 2),
  ('Weekend', '{6,7}', NULL, NULL, 3);--> statement-breakpoint
INSERT INTO "rhythm_blocks" ("rhythm_id", "title", "kind", "area", "start_time", "end_time", "remind", "remind_before")
SELECT r.id, b.title, b.kind, b.area::"area", b.s, b.e, b.remind, b.before
FROM "rhythms" r
JOIN (VALUES
  ('Werkdag', 'Dagstart', 'dagstart', 'zakelijk', '08:45', '09:00', true, 0),
  ('Werkdag', 'Diep werk', 'diep_werk', 'zakelijk', '09:00', '11:30', true, 0),
  ('Werkdag', 'Klantwerk en mail', 'klantwerk', 'zakelijk', '11:30', '12:30', false, 0),
  ('Werkdag', 'Pauze', 'pauze', 'prive', '12:30', '13:15', false, 0),
  ('Werkdag', 'Diep werk', 'diep_werk', 'zakelijk', '13:15', '15:30', false, 0),
  ('Werkdag', 'Administratie', 'administratie', 'zakelijk', '15:30', '16:30', false, 0),
  ('Werkdag', 'Klantwerk en mail', 'klantwerk', 'zakelijk', '16:30', '17:15', false, 0),
  ('Werkdag', 'Dagafsluiting', 'dagafsluiting', 'zakelijk', '17:15', '17:30', true, 0),
  ('Werkdag', 'Sport', 'sport', 'prive', '18:00', '19:00', true, 15),
  ('Vrijdag', 'Dagstart', 'dagstart', 'zakelijk', '08:45', '09:00', true, 0),
  ('Vrijdag', 'Diep werk', 'diep_werk', 'zakelijk', '09:00', '11:30', true, 0),
  ('Vrijdag', 'Klantwerk en mail', 'klantwerk', 'zakelijk', '11:30', '12:30', false, 0),
  ('Vrijdag', 'Pauze', 'pauze', 'prive', '12:30', '13:15', false, 0),
  ('Vrijdag', 'Administratie', 'administratie', 'zakelijk', '13:15', '15:00', false, 0),
  ('Vrijdag', 'Weekreview', 'weekreview', 'zakelijk', '15:00', '15:45', true, 0),
  ('Vrijdag', 'Dagafsluiting', 'dagafsluiting', 'zakelijk', '15:45', '16:00', true, 0),
  ('Weekend', 'Sport', 'sport', 'prive', '10:00', '11:30', true, 15)
) AS b(rhythm, title, kind, area, s, e, remind, before) ON b.rhythm = r.name;
