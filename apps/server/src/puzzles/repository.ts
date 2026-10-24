// Acceso al banco de puzzles (ADR 0003). La solución solo sale por `getForServer`; `getPublic` no
// lee esa columna ni la semilla (T-31.3 y T-20.4). La elección al azar sin repetir (R-21) está en
// `catalog.ts`.
import { asc, count, eq } from "drizzle-orm";
import type { Difficulty, PublicPuzzle } from "@sudoku-killer/protocol";
import type { Database } from "../db/database.ts";
import { puzzles } from "../db/schema.ts";
import { decodeSolution } from "./solution.ts";
import type { PuzzleRecord } from "./types.ts";

/** Columnas del puzzle público: nunca `solution` ni `seed`. */
const publicColumns = {
  id: puzzles.id,
  size: puzzles.size,
  boxRows: puzzles.boxRows,
  boxCols: puzzles.boxCols,
  difficulty: puzzles.difficulty,
  cages: puzzles.cages,
  givens: puzzles.givens,
};

/** Columnas de `PuzzleRecord`, solo para el servidor. */
const serverColumns = {
  ...publicColumns,
  solution: puzzles.solution,
  graderMaxLevel: puzzles.graderMaxLevel,
  graderSteps: puzzles.graderSteps,
  graderVersion: puzzles.graderVersion,
  generatorVersion: puzzles.generatorVersion,
  seed: puzzles.seed,
  givensReason: puzzles.givensReason,
};

export interface PuzzleRepository {
  /** Solo para el servidor: incluye la solución. `null` si no existe. */
  getForServer(id: string): Promise<PuzzleRecord | null>;
  /** Lo que puede salir del servidor. `null` si no existe. */
  getPublic(id: string): Promise<PublicPuzzle | null>;
  countByDifficulty(): Promise<Record<Difficulty, number>>;
  /** Los `id` de una dificultad, en orden estable (para `pickPuzzle`). */
  listIds(difficulty: Difficulty): Promise<string[]>;
}

export function createPuzzleRepository(db: Database): PuzzleRepository {
  return {
    async getForServer(id) {
      const [row] = await db.select(serverColumns).from(puzzles).where(eq(puzzles.id, id));
      return row ? { ...row, solution: decodeSolution(row.solution) } : null;
    },
    async getPublic(id) {
      const [row] = await db.select(publicColumns).from(puzzles).where(eq(puzzles.id, id));
      return row ?? null;
    },
    async countByDifficulty() {
      const rows = await db
        .select({ difficulty: puzzles.difficulty, count: count() })
        .from(puzzles)
        .groupBy(puzzles.difficulty);
      const counts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0, expert: 0 };
      for (const row of rows) counts[row.difficulty] = row.count;
      return counts;
    },
    async listIds(difficulty) {
      const rows = await db
        .select({ id: puzzles.id })
        .from(puzzles)
        .where(eq(puzzles.difficulty, difficulty))
        .orderBy(asc(puzzles.id));
      return rows.map((row) => row.id);
    },
  };
}
