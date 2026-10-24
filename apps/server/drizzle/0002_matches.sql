CREATE TABLE "match_events" (
	"match_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"server_ts" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "match_events_match_id_seq_pk" PRIMARY KEY("match_id","seq"),
	CONSTRAINT "match_events_seq_check" CHECK ("match_events"."seq" >= 1),
	CONSTRAINT "match_events_type_check" CHECK (type IN ('match.started', 'player.joined', 'player.connection', 'starter.changed', 'settings.changed', 'cell.solved', 'cell.mistake', 'hint.used', 'note.op', 'match.ended'))
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_code" text NOT NULL,
	"puzzle_id" uuid NOT NULL,
	"difficulty" text NOT NULL,
	"mode_id" text NOT NULL,
	"scoring_params_version" text NOT NULL,
	"protocol_version" smallint NOT NULL,
	"log_version" smallint NOT NULL,
	"started_at" timestamp (3) with time zone NOT NULL,
	"ended_at" timestamp (3) with time zone,
	"result" text,
	CONSTRAINT "matches_difficulty_check" CHECK (difficulty IN ('easy', 'medium', 'hard', 'expert')),
	CONSTRAINT "matches_result_check" CHECK (result IN ('victory', 'defeat')),
	CONSTRAINT "matches_ended_check" CHECK (("matches"."ended_at" IS NULL) = ("matches"."result" IS NULL))
);
--> statement-breakpoint
DROP INDEX "puzzles_generator_seed_idx";--> statement-breakpoint
ALTER TABLE "puzzles" ADD COLUMN "hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "puzzles" ADD COLUMN "mapping_version" text NOT NULL;--> statement-breakpoint
ALTER TABLE "puzzles" ADD COLUMN "retired_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_puzzle_id_puzzles_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matches_running_idx" ON "matches" USING btree ("started_at") WHERE "matches"."ended_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "puzzles_hash_idx" ON "puzzles" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "puzzles_generator_seed_idx" ON "puzzles" USING btree ("generator_version","seed");--> statement-breakpoint
-- match_events solo admite agregar filas (ADR 0004): un UPDATE o un DELETE fallan.
CREATE FUNCTION "match_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'match_events is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "match_events_append_only" BEFORE UPDATE OR DELETE ON "match_events" FOR EACH ROW EXECUTE FUNCTION "match_events_append_only"();
