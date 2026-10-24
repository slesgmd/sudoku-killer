// Equivalencia entre los niveles del calificador y las dificultades del juego (F5,
// docs/dificultad.md). La media y la difícil se separan por los pasos de nivel 3 (regla del 45):
// necesitarla varias veces exige encontrar más regiones.
import type { GradeResult } from "@sudoku-killer/engine";
import type { Difficulty } from "@sudoku-killer/protocol";

/** Cambia cuando cambia la equivalencia: el banco guardado deja de corresponder. */
export const DIFFICULTY_MAPPING_VERSION = "1";

/**
 * Dificultad de un puzzle calificado con `TECHNIQUES`, o `null` si se excluye del banco porque
 * excede las técnicas (decisión a de F5).
 * - Fácil: nivel máximo 2 o menos.
 * - Media: nivel máximo 3 con un solo paso de nivel 3.
 * - Difícil: nivel máximo 3 con 2 o más pasos de nivel 3, o nivel máximo 4.
 * - Experto: nivel máximo 5 (con `unitCombination` acotada).
 */
export function difficultyOf({ status, maxLevel, stepsByLevel }: GradeResult): Difficulty | null {
  if (status !== "solved") return null;
  if (maxLevel <= 2) return "easy";
  if (maxLevel === 3) return (stepsByLevel[3] ?? 0) === 1 ? "medium" : "hard";
  if (maxLevel === 4) return "hard";
  return "expert";
}
