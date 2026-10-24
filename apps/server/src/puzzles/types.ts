// Puzzle con su solución: solo vive en el servidor (SPEC §2.2, ADR 0003). Nunca se importa en
// packages/protocol (T-31.3).
import type { GivensReason } from "@sudoku-killer/engine";
import type { PublicPuzzle } from "@sudoku-killer/protocol";

export interface PuzzleRecord extends PublicPuzzle {
  /** `size²` dígitos, por filas. */
  readonly solution: readonly number[];
  readonly graderMaxLevel: number;
  readonly graderSteps: number;
  readonly graderVersion: string;
  readonly generatorVersion: string;
  /** Semilla del generador: con `generatorVersion`, regenera el puzzle (ADR 0006). */
  readonly seed: number;
  readonly givensReason: GivensReason;
}
