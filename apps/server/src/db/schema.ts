// Esquema de PostgreSQL con Drizzle (ADR 0003 y ADR 0006). Las migraciones se generan con
// `pnpm --filter @sudoku-killer/server db:generate` en `drizzle/`.
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { GivensReason } from "@sudoku-killer/engine";
import type { MatchEvent, MatchEventType } from "@sudoku-killer/game";
import type { Difficulty, MatchResult, PublicPuzzle } from "@sudoku-killer/protocol";

// drizzle-kit carga este archivo sin las fuentes de los paquetes del monorepo, así que aquí solo
// se importan tipos. Una prueba comprueba que estas listas coinciden con las del protocolo y del
// generador.
export const DIFFICULTY_VALUES = [
  "easy",
  "medium",
  "hard",
  "expert",
] as const satisfies readonly Difficulty[];
export const GIVENS_REASON_VALUES = [
  "none",
  "difficulty",
  "uniqueness",
] as const satisfies readonly GivensReason[];

export const MATCH_RESULT_VALUES = ["victory", "defeat"] as const satisfies readonly MatchResult[];
export const MATCH_EVENT_TYPE_VALUES = [
  "match.started",
  "player.joined",
  "player.connection",
  "starter.changed",
  "settings.changed",
  "cell.solved",
  "cell.mistake",
  "hint.used",
  "note.op",
  "match.ended",
] as const satisfies readonly MatchEventType[];

/** Versión de la forma de los eventos del registro (ADR 0004): sube si cambia `events.ts`. */
export const LOG_VERSION = 1;

const quoted = (values: readonly string[]): string =>
  values.map((value) => `'${value}'`).join(", ");

/**
 * Banco de puzzles. `solution` solo se lee con `PuzzleRepository.getForServer` (ADR 0003). El `id`
 * es un UUID aleatorio: no deriva de la semilla, para que un cliente no pueda enumerar el banco ni
 * predecir el puzzle siguiente (T-20.4). Las filas nunca se borran: las que salen del manifiesto
 * quedan retiradas (`retired_at`), y las partidas viejas conservan su clave foránea (F9).
 */
export const puzzles = pgTable(
  "puzzles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    size: smallint("size").notNull(),
    boxRows: smallint("box_rows").notNull(),
    boxCols: smallint("box_cols").notNull(),
    difficulty: text("difficulty", { enum: DIFFICULTY_VALUES }).notNull(),
    cages: jsonb("cages").$type<PublicPuzzle["cages"]>().notNull(),
    givens: jsonb("givens").$type<PublicPuzzle["givens"]>().notNull(),
    /** Un carácter en base 36 por celda, por filas (`encodeSolution`). */
    solution: text("solution").notNull(),
    graderMaxLevel: smallint("grader_max_level").notNull(),
    graderSteps: smallint("grader_steps").notNull(),
    graderVersion: text("grader_version").notNull(),
    givensReason: text("givens_reason", { enum: GIVENS_REASON_VALUES }).notNull(),
    generatorVersion: text("generator_version").notNull(),
    /** Entero de 32 bits sin signo: no cabe en `integer`. */
    seed: bigint("seed", { mode: "number" }).notNull(),
    /** El `hash` del manifiesto (ADR 0006): identifica el puzzle con sus números iniciales. */
    hash: text("hash").notNull(),
    /** Versión de la equivalencia de dificultades con que se cargó (`docs/dificultad.md`). */
    mappingVersion: text("mapping_version").notNull(),
    /** Desde cuándo no está en el manifiesto vigente; `null` si se puede elegir. */
    retiredAt: timestamp("retired_at", { withTimezone: true, precision: 3 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("puzzles_difficulty_idx").on(table.difficulty),
    // Con otra equivalencia y el mismo generador, una semilla da otro puzzle: no es única.
    index("puzzles_generator_seed_idx").on(table.generatorVersion, table.seed),
    uniqueIndex("puzzles_hash_idx").on(table.hash),
    check("puzzles_difficulty_check", sql.raw(`difficulty IN (${quoted(DIFFICULTY_VALUES)})`)),
    check(
      "puzzles_givens_reason_check",
      sql.raw(`givens_reason IN (${quoted(GIVENS_REASON_VALUES)})`),
    ),
    // T-20.3: ningún puzzle del banco excede las técnicas.
    check("puzzles_grader_max_level_check", sql`${table.graderMaxLevel} BETWEEN 1 AND 5`),
  ],
);

/**
 * Partidas (ADR 0003). Se insertan con su `match.started` y se cierran (`ended_at` y `result`) en la
 * misma transacción que su `match.ended`. Las que no tienen `ended_at` se reconstruyen al arrancar.
 */
export const matches = pgTable(
  "matches",
  {
    /** Lo genera el servidor: es el `matchId` de `match.started`. */
    id: uuid("id").primaryKey(),
    roomCode: text("room_code").notNull(),
    puzzleId: uuid("puzzle_id")
      .notNull()
      .references(() => puzzles.id),
    difficulty: text("difficulty", { enum: DIFFICULTY_VALUES }).notNull(),
    modeId: text("mode_id").notNull(),
    scoringParamsVersion: text("scoring_params_version").notNull(),
    protocolVersion: smallint("protocol_version").notNull(),
    logVersion: smallint("log_version").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, precision: 3 }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true, precision: 3 }),
    result: text("result", { enum: MATCH_RESULT_VALUES }),
  },
  (table) => [
    index("matches_running_idx")
      .on(table.startedAt)
      .where(sql`${table.endedAt} IS NULL`),
    check("matches_difficulty_check", sql.raw(`difficulty IN (${quoted(DIFFICULTY_VALUES)})`)),
    check("matches_result_check", sql.raw(`result IN (${quoted(MATCH_RESULT_VALUES)})`)),
    check("matches_ended_check", sql`(${table.endedAt} IS NULL) = (${table.result} IS NULL)`),
  ],
);

/**
 * Registro de eventos (ADR 0004): solo hechos, en orden de `seq`. Solo se agregan filas; un trigger
 * de la migración rechaza `UPDATE` y `DELETE`.
 */
export const matchEvents = pgTable(
  "match_events",
  {
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id),
    seq: integer("seq").notNull(),
    type: text("type", { enum: MATCH_EVENT_TYPE_VALUES }).notNull(),
    payload: jsonb("payload").$type<MatchEvent["payload"]>().notNull(),
    /** `event.ts`, al milisegundo. */
    serverTs: timestamp("server_ts", { withTimezone: true, precision: 3 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.matchId, table.seq] }),
    check("match_events_seq_check", sql`${table.seq} >= 1`),
    check("match_events_type_check", sql.raw(`type IN (${quoted(MATCH_EVENT_TYPE_VALUES)})`)),
  ],
);
