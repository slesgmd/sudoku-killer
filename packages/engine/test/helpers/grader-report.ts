// Mediciones del calificador para F5 (informe del corpus). Solo miden: no cambian `grade` ni las
// técnicas. `gradeWithout` repite el bucle de `grade` sin una técnica; `unitCombinationCosts` dice
// qué tan grande es la unidad que justifica cada deducción de `unitCombination`.
import {
  TECHNIQUES,
  type GradeStep,
  type KillerPuzzle,
  type TechniqueId,
} from "@sudoku-killer/engine";
import { at } from "../../src/model/at.ts";
import { graderContextOf, type GraderContext } from "../../src/grader/context.ts";
import { applyDeduction, createGraderState, type GraderState } from "../../src/grader/state.ts";

const bit = (digit: number): number => 1 << (digit - 1);
const digitsIn = (mask: number): number[] =>
  [...Array(16).keys()].filter((i) => (mask >> i) & 1).map((i) => i + 1);

/** El bucle de `grade` con todas las técnicas salvo `excluded`. */
export function gradeWithout(
  puzzle: KillerPuzzle,
  excluded: TechniqueId,
): { status: "solved" | "exceedsTechniques" | "contradiction"; maxLevel: number } {
  const techniques = TECHNIQUES.filter(({ id }) => id !== excluded);
  const context = graderContextOf(puzzle);
  const state = createGraderState(context);
  let maxLevel = 1;
  while (state.unplaced > 0 && !state.contradiction) {
    let found = false;
    for (const technique of techniques) {
      const deductions = technique.find(context, state);
      if (deductions.length === 0) continue;
      for (const deduction of deductions) applyDeduction(context, state, deduction);
      maxLevel = Math.max(maxLevel, technique.level);
      found = true;
      break;
    }
    if (!found) break;
  }
  if (state.contradiction) return { status: "contradiction", maxLevel };
  return { status: state.unplaced === 0 ? "solved" : "exceedsTechniques", maxLevel };
}

/** Lo que tiene que razonar una persona para una deducción de `unitCombination`. */
export interface UnitCost {
  /** Jaulas que tocan la unidad. */
  readonly cages: number;
  /** De ellas, las que todavía tienen alguna celda vacía dentro de la unidad. */
  readonly open: number;
  /** De ellas, las que sobresalen de la unidad. */
  readonly protruding: number;
  /**
   * Combinaciones de la unidad: formas de repartir sus dígitos entre las jaulas (un conjunto de
   * dígitos por jaula, sin repetir entre jaulas), en las que cada jaula cuadra con los candidatos.
   */
  readonly combinations: number;
}

interface UnitAnalysis extends UnitCost {
  /** Candidatos de cada celda de la unidad que aparecen en alguna combinación. */
  readonly support: readonly number[];
}

/**
 * Enumeración directa, escrita aparte de `unit-combination.ts`: para cada jaula, los conjuntos de
 * dígitos de sus celdas de dentro (completables fuera); después, cuántas combinaciones de jaulas
 * usan todos los dígitos (hacia adelante) y qué conjuntos llegan a completarse (hacia atrás).
 */
function analyzeUnit(
  context: GraderContext,
  { candidates, values }: GraderState,
  unit: readonly number[],
): UnitAnalysis {
  const inUnit = new Set(unit);
  const pieces = [...new Set(unit.map((cell) => at(context.cageOf, cell)))].map((index) => {
    const { cells, sum } = at(context.cages, index);
    return {
      sum,
      inside: cells.filter((cell) => inUnit.has(cell)),
      outside: cells.filter((cell) => !inUnit.has(cell)),
    };
  });

  const options = pieces.map(({ sum, inside, outside }) => {
    const byDigits = new Map<number, number[]>();
    const completes = (i: number, used: number, left: number): boolean =>
      i === outside.length
        ? left === 0
        : digitsIn(at(candidates, at(outside, i)) & ~used).some((d) =>
            completes(i + 1, used | bit(d), left - d),
          );
    const assigned: number[] = [];
    const visit = (i: number, used: number, left: number): void => {
      if (left < 0) return;
      if (i === inside.length) {
        if (!completes(0, used, left)) return;
        const masks = byDigits.get(used) ?? inside.map(() => 0);
        assigned.forEach((d, j) => (masks[j] = at(masks, j) | bit(d)));
        byDigits.set(used, masks);
        return;
      }
      for (const d of digitsIn(at(candidates, at(inside, i)) & ~used)) {
        assigned[i] = d;
        visit(i + 1, used | bit(d), left - d);
      }
    };
    visit(0, 0, sum);
    return byDigits;
  });

  const reach: Map<number, number>[] = [new Map([[0, 1]])];
  options.forEach((byDigits, p) => {
    const next = new Map<number, number>();
    for (const [used, count] of at(reach, p)) {
      for (const digits of byDigits.keys()) {
        if ((used & digits) === 0) next.set(used | digits, (next.get(used | digits) ?? 0) + count);
      }
    }
    reach.push(next);
  });

  const support = unit.map(() => 0);
  let finishing = new Set([context.full]);
  for (let p = pieces.length - 1; p >= 0; p--) {
    const before = new Set<number>();
    for (const [digits, masks] of at(options, p)) {
      const starts = [...at(reach, p).keys()].filter(
        (used) => (used & digits) === 0 && finishing.has(used | digits),
      );
      if (starts.length === 0) continue;
      for (const used of starts) before.add(used);
      at(pieces, p).inside.forEach((cell, j) => {
        const index = unit.indexOf(cell);
        support[index] = at(support, index) | at(masks, j);
      });
    }
    finishing = before;
  }

  return {
    cages: pieces.length,
    open: pieces.filter(({ inside }) => inside.some((cell) => at(values, cell) === 0)).length,
    protruding: pieces.filter(({ outside }) => outside.length > 0).length,
    combinations: at(reach, pieces.length).get(context.full) ?? 0,
    support,
  };
}

/**
 * Para cada deducción del paso de `unitCombination` (aplicado sobre `state`), la unidad más chica
 * que la justifica: entre la fila, la columna y la caja de la celda que excluyen el dígito, la de
 * menos combinaciones (y, a igualdad, menos jaulas abiertas). Lanza si ninguna la justifica, porque entonces
 * la medición no describe lo que hizo el calificador.
 */
export function unitCombinationCosts(
  puzzle: KillerPuzzle,
  state: GraderState,
  step: GradeStep,
): UnitCost[] {
  const context = graderContextOf(puzzle);
  const analyses = new Map<number, UnitAnalysis>();
  const analysisOf = (index: number): UnitAnalysis => {
    let analysis = analyses.get(index);
    if (!analysis) {
      analysis = analyzeUnit(context, state, at(context.units, index));
      analyses.set(index, analysis);
    }
    return analysis;
  };
  return step.deductions.map(({ kind, cell, digit }) => {
    const justifying = context.units.flatMap((unit, index) => {
      const position = unit.indexOf(cell);
      if (kind !== "eliminate" || position < 0) return [];
      const analysis = analysisOf(index);
      return (at(analysis.support, position) & bit(digit)) === 0 ? [analysis] : [];
    });
    justifying.sort((a, b) => a.combinations - b.combinations || a.open - b.open);
    const [best] = justifying;
    if (!best) throw new Error(`No unit justifies ${kind} ${String(digit)} at ${String(cell)}`);
    const { cages, open, protruding, combinations } = best;
    return { cages, open, protruding, combinations };
  });
}

/** Reproduce la traza de `grade` y llama a `visit` con el estado de antes de cada paso. */
export function replayTrace(
  puzzle: KillerPuzzle,
  trace: readonly GradeStep[],
  visit: (state: GraderState, step: GradeStep) => void,
): void {
  const context = graderContextOf(puzzle);
  const state = createGraderState(context);
  for (const step of trace) {
    visit(state, step);
    for (const deduction of step.deductions) applyDeduction(context, state, deduction);
  }
}
