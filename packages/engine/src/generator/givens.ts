// Números iniciales por dificultad (SPEC R-20): se agregan a un puzzle generado, repartidos
// entre las cajas y con semilla, y con una guarda opcional que impide que el puzzle baje del piso
// de su dificultad. Puro: el orden de las celdas sale de la semilla.
import type { Given } from "../types.ts";
import { at } from "../model/at.ts";
import { layoutOf } from "../model/geometry.ts";
import { solveA } from "../solver-a/solve.ts";
import { solveB } from "../solver-b/solve.ts";
import { grade, type GradeResult } from "../grader/grade.ts";
import type { GeneratedPuzzle } from "./generate.ts";
import { createRng, isValidSeed, shuffle } from "./rng.ts";

/**
 * Se mezcla con la semilla para que el orden de las celdas no repita la secuencia con la que
 * `generatePuzzle` armó la cuadrícula a partir de la misma semilla.
 */
const GIVENS_SALT = 0x6a09e667;

export interface AddGivensOptions {
  /** Números iniciales en total, incluidos los de unicidad que ya tenga el puzzle. */
  readonly count: number;
  /** Entero de 32 bits sin signo: ordena las celdas candidatas (T-35.6). */
  readonly seed: number;
  /**
   * Guarda: cada número se agrega solo si el puzzle, calificado con él, la cumple (por ejemplo,
   * que todavía necesite un paso de nivel 3). Sin guarda, se agregan los primeros del orden.
   */
  readonly keep?: (result: GradeResult) => boolean;
}

export interface PuzzleWithGivens {
  /** El puzzle con los números agregados; `givensReason` pasa a `difficulty` si se agregó alguno. */
  readonly generated: GeneratedPuzzle;
  /** Calificación del puzzle final, con todos sus números iniciales. */
  readonly result: GradeResult;
}

/**
 * Orden de las celdas libres: una vuelta tras otra por las cajas, en un orden de cajas al azar, con
 * una celda al azar de cada caja por vuelta. Así los números quedan repartidos entre las cajas.
 */
function spreadOrder(generated: GeneratedPuzzle, seed: number): number[] {
  const rng = createRng((seed ^ GIVENS_SALT) >>> 0);
  const taken = new Set(generated.puzzle.givens.map(({ cell }) => cell));
  const boxes = layoutOf(generated.puzzle).boxes.map((box) =>
    shuffle(
      rng,
      box.filter((cell) => !taken.has(cell)),
    ),
  );
  const order = shuffle(
    rng,
    boxes.map((_, index) => index),
  );
  const cells: number[] = [];
  const rounds = Math.max(...boxes.map((box) => box.length));
  for (let round = 0; round < rounds; round++) {
    for (const index of order) {
      const cell = at(boxes, index)[round];
      if (cell !== undefined) cells.push(cell);
    }
  }
  return cells;
}

/**
 * Agrega números iniciales de la solución hasta tener `count`, en el orden repartido por cajas, y
 * saltando los que no cumplen `keep`. Devuelve `null` si se recorren todas las celdas sin llegar a
 * `count`. La unicidad se confirma con A y con B en el puzzle final; si no, lanza `Error` (es un
 * error de un solver: números de la solución no pueden quitar la unicidad). Lanza `RangeError` con
 * opciones inválidas. Determinista.
 */
export function addGivens(
  generated: GeneratedPuzzle,
  { count, seed, keep }: AddGivensOptions,
): PuzzleWithGivens | null {
  const { puzzle, solution } = generated;
  if (!Number.isInteger(count) || count < 0 || count > solution.length) {
    throw new RangeError(`Invalid givens count ${String(count)}`);
  }
  if (!isValidSeed(seed)) throw new RangeError(`Invalid seed ${String(seed)}`);

  let givens: readonly Given[] = puzzle.givens;
  let result: GradeResult | null = null;
  for (const cell of spreadOrder(generated, seed)) {
    if (givens.length >= count) break;
    const next = [...givens, { cell, value: at(solution, cell) }].sort((a, b) => a.cell - b.cell);
    if (keep) {
      const graded = grade({ ...puzzle, givens: next });
      if (!keep(graded)) continue;
      result = graded;
    }
    givens = next;
  }
  if (givens.length < count) return null;

  const added = givens.length > puzzle.givens.length;
  const final = { ...puzzle, givens };
  if (added) {
    const a = solveA(final);
    const b = solveB(final);
    const same = (found: readonly (readonly number[])[]): boolean =>
      found.length === 1 && at(found, 0).every((digit, cell) => digit === at(solution, cell));
    if (a.count !== 1 || b.count !== 1 || !same(a.solutions) || !same(b.solutions)) {
      throw new Error(`Solver discrepancy after adding givens (seed ${String(seed)})`);
    }
  }
  return {
    generated: {
      ...generated,
      puzzle: final,
      givensReason: added ? "difficulty" : generated.givensReason,
    },
    result: result ?? grade(final),
  };
}
