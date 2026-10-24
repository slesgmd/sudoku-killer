// Regeneración de una semilla del banco (F5, ADR 0006): el generador es determinista, así que la
// semilla y las reglas de su dificultad bastan para obtener el mismo puzzle. La usan el servidor
// (carga y verificación del banco) y el servidor simulado del cliente en desarrollo (F8).
import {
  addGivens,
  generatePuzzle,
  grade,
  type GeneratedPuzzle,
  type GradeResult,
} from "@sudoku-killer/engine";
import type { Difficulty } from "@sudoku-killer/protocol";
import { DIFFICULTY_RULES, difficultyOfSeed } from "./difficulty.ts";

/** Una semilla generada para su dificultad, con sus números iniciales y su calificación. */
export interface RegeneratedSeed {
  readonly seed: number;
  /** La dificultad de la semilla (`difficultyOfSeed`). */
  readonly difficulty: Difficulty;
  /** Si el puzzle final cumple la banda de su dificultad y entra al banco. */
  readonly accepted: boolean;
  /** El puzzle final, o el base si la guarda no dejó llegar a la cantidad de números. */
  readonly generated: GeneratedPuzzle;
  readonly result: GradeResult;
}

/**
 * Genera el puzzle de la semilla, le agrega los números iniciales de su dificultad (repartidos por
 * cajas, con la guarda del piso de la banda) y lo califica con ellos.
 */
export function regenerateSeed(seed: number): RegeneratedSeed {
  const difficulty = difficultyOfSeed(seed);
  const rule = DIFFICULTY_RULES[difficulty];
  const base = generatePuzzle({ seed });
  const withGivens =
    rule.givens > 0 ? addGivens(base, { count: rule.givens, seed, keep: rule.floor }) : null;
  const generated = withGivens?.generated ?? base;
  const result = withGivens?.result ?? grade(base.puzzle);
  const reached = rule.givens === 0 || withGivens !== null;
  return { seed, difficulty, accepted: reached && rule.accepts(result), generated, result };
}

/**
 * El puzzle y su solución en un orden de campos fijo: es lo que se hashea (SHA-256, primeros 16
 * dígitos hexadecimales) para el manifiesto. El hash lo calcula cada entorno con su API.
 */
export function canonicalPuzzle({ puzzle, solution }: GeneratedPuzzle): string {
  return JSON.stringify({
    size: puzzle.size,
    boxRows: puzzle.boxRows,
    boxCols: puzzle.boxCols,
    cages: puzzle.cages.map(({ id, cells, sum }) => ({ id, cells, sum })),
    givens: puzzle.givens.map(({ cell, value }) => ({ cell, value })),
    solution,
  });
}
