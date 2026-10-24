CREATE TABLE "puzzles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"size" smallint NOT NULL,
	"box_rows" smallint NOT NULL,
	"box_cols" smallint NOT NULL,
	"difficulty" text NOT NULL,
	"cages" jsonb NOT NULL,
	"givens" jsonb NOT NULL,
	"solution" text NOT NULL,
	"grader_max_level" smallint NOT NULL,
	"grader_steps" smallint NOT NULL,
	"grader_version" text NOT NULL,
	"givens_reason" text NOT NULL,
	"generator_version" text NOT NULL,
	"seed" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "puzzles_difficulty_check" CHECK (difficulty IN ('easy', 'medium', 'hard', 'expert')),
	CONSTRAINT "puzzles_givens_reason_check" CHECK (givens_reason IN ('none', 'easy', 'uniqueness')),
	CONSTRAINT "puzzles_grader_max_level_check" CHECK ("puzzles"."grader_max_level" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE INDEX "puzzles_difficulty_idx" ON "puzzles" USING btree ("difficulty");--> statement-breakpoint
CREATE UNIQUE INDEX "puzzles_generator_seed_idx" ON "puzzles" USING btree ("generator_version","seed");