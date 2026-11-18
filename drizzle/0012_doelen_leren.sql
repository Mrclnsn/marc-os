CREATE TABLE "goal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"date" date NOT NULL,
	"value" double precision NOT NULL,
	"note" text,
	"source" text DEFAULT 'app' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"title" text NOT NULL,
	"due_date" date,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" date,
	"project_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"area" text DEFAULT 'zakelijk' NOT NULL,
	"period_kind" text DEFAULT 'year' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"parent_id" uuid,
	"measure" text DEFAULT 'manual' NOT NULL,
	"source" text,
	"habit_id" uuid,
	"learning_id" uuid,
	"target_value" double precision,
	"start_value" double precision,
	"unit" text,
	"target_per" text,
	"direction" text,
	"curve" text DEFAULT 'linear' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"date" date NOT NULL,
	"minutes" integer NOT NULL,
	"note" text,
	"source" text DEFAULT 'app' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'cursus' NOT NULL,
	"area" "area" DEFAULT 'zakelijk' NOT NULL,
	"status" text DEFAULT 'bezig' NOT NULL,
	"goal" text,
	"url" text,
	"progress_done" double precision DEFAULT 0 NOT NULL,
	"progress_total" double precision,
	"progress_unit" text,
	"hours_target" double precision,
	"start_date" date,
	"target_date" date,
	"finished_at" date,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "learning_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "learning_id" uuid;--> statement-breakpoint
ALTER TABLE "goal_entries" ADD CONSTRAINT "goal_entries_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_milestones" ADD CONSTRAINT "goal_milestones_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_milestones" ADD CONSTRAINT "goal_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_parent_id_goals_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_habit_id_habits_id_fk" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_learning_id_learning_topics_id_fk" FOREIGN KEY ("learning_id") REFERENCES "public"."learning_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_sessions_topic_id_learning_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."learning_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "goal_entries_goal_date_uq" ON "goal_entries" USING btree ("goal_id","date");--> statement-breakpoint
CREATE INDEX "goal_milestones_goal_idx" ON "goal_milestones" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "goals_parent_idx" ON "goals" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "learning_sessions_topic_idx" ON "learning_sessions" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "learning_sessions_date_idx" ON "learning_sessions" USING btree ("date");--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_learning_id_learning_topics_id_fk" FOREIGN KEY ("learning_id") REFERENCES "public"."learning_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_learning_id_learning_topics_id_fk" FOREIGN KEY ("learning_id") REFERENCES "public"."learning_topics"("id") ON DELETE set null ON UPDATE no action;