// Comprobaciones del calificador compartidas por la prueba rápida y el corpus (T-35.4 y T-35.5).
import { expect } from "vitest";
import {
  MAX_TECHNIQUE_LEVEL,
  TECHNIQUES,
  UNRATED,
  createRng,
  grade,
  levelToDeduce,
  type Deduction,
  type GeneratedPuzzle,
  type GradeResult,
  type Grid,
  type KillerPuzzle,
} from "@sudoku-killer/engine";
import { at } from "../../src/model/at.ts";
import { graderContextOf } from "../../src/grader/context.ts";
import { applyDeduction, createGraderState, type GraderState } from "../../src/grader/state.ts";

/** Una deducción es compatible con una solución si coloca su dígito o quita otro. */
export function agrees(deduction: Deduction, solution: Grid): boolean {
  const digit = at(solution, deduction.cell);
  return deduction.kind === "place" ? deduction.digit === digit : deduction.digit !== digit;
}

export function expectCandidatesKeep(state: GraderState, solution: Grid): void {
  solution.forEach((digit, cell) => {
    expect(at(state.candidates, cell) & (1 << (digit - 1)), `cell ${String(cell)}`).not.toBe(0);
  });
}

/** Tablero con los dígitos de la solución en `cells` y 0 en el resto. */
export function boardWith(solution: Grid, cells: Iterable<number>): number[] {
  const values = new Array<number>(solution.length).fill(0);
  for (const cell of cells) values[cell] = at(solution, cell);
  return values;
}

/**
 * Estado con los dígitos de la solución en `cells` y, además, sin los candidatos de `eliminations`
 * que no son el de la solución: un estado cualquiera que todavía la admite (como las notas de un
 * jugador que solo borra candidatos equivocados).
 */
export function stateWith(
  puzzle: KillerPuzzle,
  solution: Grid,
  cells: Iterable<number>,
  eliminations: Iterable<readonly [number, number]>,
): GraderState {
  const context = graderContextOf(puzzle);
  const state = createGraderState(context, boardWith(solution, cells));
  for (const [cell, digit] of eliminations) {
    if (digit !== at(solution, cell))
      applyDeduction(context, state, { kind: "eliminate", cell, digit });
  }
  return state;
}

/**
 * Reproduce la traza de `grade` con un estado propio y comprueba: cada técnica anterior a la del
 * paso (todas las de menor nivel incluidas) no encuentra nada; la técnica encuentra exactamente
 * esas deducciones; ninguna contradice la solución (T-35.4); y después de aplicarlas el dígito de
 * la solución sigue entre los candidatos de cada celda.
 */
export function expectSoundGrade(puzzle: KillerPuzzle, solution: Grid): GradeResult {
  const result = grade(puzzle, { trace: true });
  const context = graderContextOf(puzzle);
  const state = createGraderState(context);
  expectCandidatesKeep(state, solution);
  const trace = result.trace ?? [];
  for (const step of trace) {
    const index = TECHNIQUES.findIndex((technique) => technique.id === step.technique);
    for (const lower of TECHNIQUES.slice(0, index)) {
      expect(lower.level).toBeLessThanOrEqual(step.level);
      expect(lower.find(context, state), `${lower.id} before ${step.technique}`).toEqual([]);
    }
    expect(at(TECHNIQUES, index).find(context, state)).toEqual(step.deductions);
    for (const deduction of step.deductions) {
      expect(agrees(deduction, solution), JSON.stringify(deduction)).toBe(true);
      applyDeduction(context, state, deduction);
    }
    expectCandidatesKeep(state, solution);
  }

  expect(result.status).not.toBe("contradiction");
  expect(result.steps).toBe(trace.length);
  expect(result.unplaced).toBe(state.unplaced);
  expect(result.stepsByLevel.reduce((a, b) => a + b, 0)).toBe(trace.length);
  if (result.status === "solved") {
    expect([...state.values]).toEqual([...solution]);
    expect(result.maxLevel).toBe(Math.max(1, ...trace.map((step) => step.level)));
    expect(result.maxLevel).toBeLessThanOrEqual(MAX_TECHNIQUE_LEVEL);
  } else {
    // Nunca adivina: se detiene en un estado donde ninguna técnica encuentra nada.
    expect(result.maxLevel).toBe(UNRATED);
    expect(result.unplaced).toBeGreaterThan(0);
    for (const technique of TECHNIQUES) expect(technique.find(context, state)).toEqual([]);
  }
  return result;
}

export interface MonotonyOptions {
  /** Celdas vacías que se siguen en cada puzzle. */
  readonly targets: number;
  /** Tandas de celdas correctas agregadas después del estado inicial. */
  readonly batches: number;
  readonly batchSize: number;
}

/**
 * Monotonía de `levelToDeduce` a lo largo de una partida (T-35.5): para `targets` celdas vacías
 * elegidas con la semilla, se mide el nivel desde los números iniciales y después de cada tanda de
 * celdas correctas agregadas (nunca la celda seguida, en un orden aleatorio con la misma semilla).
 * El nivel nunca sube y, si el puzzle se resuelve, nunca pasa del `maxLevel` de `grade`. Devuelve
 * las comparaciones hechas y los niveles medidos.
 */
export function expectMonotoneLevels(
  { puzzle, solution }: GeneratedPuzzle,
  seed: number,
  { targets, batches, batchSize }: MonotonyOptions,
): { comparisons: number; levels: number[] } {
  const graded = grade(puzzle);
  const ceiling = graded.status === "solved" ? graded.maxLevel : UNRATED;
  const givens = new Set(puzzle.givens.map(({ cell }) => cell));
  const empty = solution.flatMap((_, cell) => (givens.has(cell) ? [] : [cell]));
  const rng = createRng(seed);
  const shuffle = (cells: number[]): number[] => {
    for (let i = cells.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [cells[i], cells[j]] = [at(cells, j), at(cells, i)];
    }
    return cells;
  };

  let comparisons = 0;
  const levels: number[] = [];
  for (const target of shuffle([...empty]).slice(0, targets)) {
    const others = shuffle(empty.filter((cell) => cell !== target));
    let previous = UNRATED;
    for (let batch = 0; batch <= batches && batch * batchSize <= others.length; batch++) {
      const values = boardWith(solution, others.slice(0, batch * batchSize));
      const level = levelToDeduce(target, { puzzle, values });
      const where = `seed ${String(seed)}, cell ${String(target)}, batch ${String(batch)}`;
      expect(level, where).toBeGreaterThanOrEqual(1);
      expect(level, where).toBeLessThanOrEqual(ceiling);
      if (batch > 0) {
        expect(level, where).toBeLessThanOrEqual(previous);
        comparisons++;
      }
      levels.push(level);
      previous = level;
    }
  }
  return { comparisons, levels };
}
