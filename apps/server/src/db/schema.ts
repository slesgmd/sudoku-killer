// Esquema de PostgreSQL con Drizzle (ADR 0003 y ADR 0006). Las migraciones se generan con
// `pnpm --filter @sudoku-killer/server db:generate` en `drizzle/`.
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { GivensReason } from "@sudoku-killer/engine";
import type { Difficulty, PublicPuzzle } from "@sudoku-killer/protocol";

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
  "easy",
  "uniqueness",
] as const satisfies readonly GivensReason[];

const quoted = (values: readonly string[]): string =>
  values.map((value) => `'${value}'`).join(", ");

/**
 * Banco de puzzles. `solution` solo se lee con `PuzzleRepository.getForServer` (ADR 0003). El `id`
 * es un UUID aleatorio: no deriva de la semilla, para que un cliente no pueda enumerar el banco ni
 * predecir el puzzle siguiente (T-20.4).
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("puzzles_difficulty_idx").on(table.difficulty),
    uniqueIndex("puzzles_generator_seed_idx").on(table.generatorVersion, table.seed),
    check("puzzles_difficulty_check", sql.raw(`difficulty IN (${quoted(DIFFICULTY_VALUES)})`)),
    check(
      "puzzles_givens_reason_check",
      sql.raw(`givens_reason IN (${quoted(GIVENS_REASON_VALUES)})`),
    ),
    // T-20.3: ningún puzzle del banco excede las técnicas.
    check("puzzles_grader_max_level_check", sql`${table.graderMaxLevel} BETWEEN 1 AND 5`),
  ],
);
