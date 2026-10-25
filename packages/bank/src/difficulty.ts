// Dificultades del juego (F5, docs/dificultad.md): cuántos números iniciales lleva cada una, la
// guarda con que se agregan y la banda de niveles que tiene que cumplir el puzzle, calificado con
// sus números. Las bandas no se solapan: cada dificultad sube un nivel de técnica.
import type { GradeResult } from "@sudoku-killer/engine";
import { DIFFICULTIES, DIFFICULTY_GIVENS, type Difficulty } from "@sudoku-killer/protocol";

/** Cambia cuando cambian las reglas de abajo: el banco guardado deja de corresponder. */
export const DIFFICULTY_MAPPING_VERSION = "2";

export interface DifficultyRule {
  /** Números iniciales en total, incluidos los de unicidad (0: solo los de unicidad). */
  readonly givens: number;
  /**
   * Piso de la guarda de `addGivens`: un número se agrega solo si el puzzle lo sigue cumpliendo.
   * Mientras el puzzle exceda las técnicas, no hay piso (un número más puede hacerlo resoluble).
   */
  readonly floor: (result: GradeResult) => boolean;
  /** Banda que tiene que cumplir el puzzle final para entrar al banco. */
  readonly accepts: (result: GradeResult) => boolean;
}

const solved = (result: GradeResult): boolean => result.status === "solved";
const stepsAt = (result: GradeResult, level: number): number => result.stepsByLevel[level] ?? 0;

/**
 * Versión 2 (aprobada el 2026-10-23, tras la prueba en papel); las cantidades salen de
 * `DIFFICULTY_GIVENS` (protocolo), que el Lobby también muestra:
 * - Fácil: 30 números, nivel máximo 1.
 * - Media: 22 números, nivel máximo 2 (con algún paso de nivel 2).
 * - Difícil: 10 números, nivel máximo 3 o 4, con algún paso de nivel 3.
 * - Experto: sin números (salvo los de unicidad), nivel máximo 5 con `unitCombination` acotada.
 */
export const DIFFICULTY_RULES: Readonly<Record<Difficulty, DifficultyRule>> = {
  easy: {
    givens: DIFFICULTY_GIVENS.easy,
    floor: () => true,
    accepts: (r) => solved(r) && r.maxLevel === 1,
  },
  medium: {
    givens: DIFFICULTY_GIVENS.medium,
    floor: (r) => !solved(r) || stepsAt(r, 2) > 0,
    accepts: (r) => solved(r) && r.maxLevel === 2,
  },
  hard: {
    givens: DIFFICULTY_GIVENS.hard,
    floor: (r) => !solved(r) || stepsAt(r, 3) > 0,
    accepts: (r) => solved(r) && (r.maxLevel === 3 || r.maxLevel === 4) && stepsAt(r, 3) > 0,
  },
  expert: {
    givens: DIFFICULTY_GIVENS.expert,
    floor: () => true,
    accepts: (r) => solved(r) && r.maxLevel === 5,
  },
};

/**
 * Cada semilla pertenece a una sola dificultad (por su resto al dividirla por 4), para que dos
 * puzzles del banco nunca compartan cuadrícula y jaulas: los números iniciales se agregan a un
 * puzzle ya generado.
 */
export function difficultyOfSeed(seed: number): Difficulty {
  const difficulty = DIFFICULTIES[seed % DIFFICULTIES.length];
  if (!difficulty) throw new RangeError(`Invalid seed ${String(seed)}`);
  return difficulty;
}

/** Números iniciales de cada dificultad, para el manifiesto. */
export function givensByDifficulty(): Record<Difficulty, number> {
  return {
    easy: DIFFICULTY_RULES.easy.givens,
    medium: DIFFICULTY_RULES.medium.givens,
    hard: DIFFICULTY_RULES.hard.givens,
    expert: DIFFICULTY_RULES.expert.givens,
  };
}
