// Calificador humano (F4e, SPEC R-35): resuelve con técnicas por niveles, siempre con la de menor
// nivel que encuentre algo, y nunca adivina. `levelToDeduce` da el nivel mínimo con el que una celda
// queda determinada desde un estado (F6 lo usa para puntuar).
import type { KillerPuzzle } from "../types.ts";
import { at } from "../model/at.ts";
import { popcount } from "../model/mask.ts";
import { cageCombination, cageForcedDigit } from "./cages.ts";
import { graderContextOf, type GraderContext } from "./context.ts";
import { innieOutie } from "./rule45.ts";
import { cageLastCell, hiddenSingle, nakedSingle } from "./singles.ts";
import { applyDeduction, createGraderState, type GraderState } from "./state.ts";
import { MAX_TECHNIQUE_LEVEL, UNRATED, type Deduction, type Technique } from "./types.ts";

/** Técnicas por nivel; dentro de un nivel, en el orden en que se prueban. */
export const TECHNIQUES: readonly Technique[] = [
  nakedSingle,
  hiddenSingle,
  cageLastCell,
  cageCombination,
  cageForcedDigit,
  innieOutie,
];

/** Un paso: todas las deducciones que una técnica encontró en un mismo estado. */
export interface GradeStep {
  readonly technique: Technique["id"];
  readonly level: number;
  readonly deductions: readonly Deduction[];
}

export type GradeStatus = "solved" | "exceedsTechniques" | "contradiction";

export interface GradeResult {
  /**
   * `solved` si las técnicas llenan el tablero; `exceedsTechniques` si se quedan sin deducciones
   * antes (el calificador nunca adivina); `contradiction` si el puzzle no tiene solución y una
   * celda se quedó sin candidatos.
   */
  readonly status: GradeStatus;
  /** Nivel de la técnica más difícil que hizo falta (`graderMaxLevel`), o `UNRATED` si no terminó. */
  readonly maxLevel: number;
  /** Cantidad de pasos (`graderSteps`). */
  readonly steps: number;
  /** Pasos de cada nivel: `stepsByLevel[level]`, con el índice 0 sin usar. */
  readonly stepsByLevel: readonly number[];
  /** Celdas vacías al terminar. */
  readonly unplaced: number;
  /** Los pasos en orden, solo con `trace: true`. */
  readonly trace?: readonly GradeStep[];
}

export interface GradeOptions {
  readonly trace?: boolean;
}

/**
 * Busca la primera técnica, de menor a mayor nivel, que encuentra deducciones, y las aplica todas.
 * Devuelve el paso, o `null` si ninguna técnica encuentra nada.
 */
function nextStep(context: GraderContext, state: GraderState): GradeStep | null {
  for (const technique of TECHNIQUES) {
    const deductions = technique.find(context, state);
    if (deductions.length === 0) continue;
    for (const deduction of deductions) applyDeduction(context, state, deduction);
    return { technique: technique.id, level: technique.level, deductions };
  }
  return null;
}

function cageSumsHold(context: GraderContext, state: GraderState): boolean {
  return context.cages.every(
    ({ cells, sum }) => cells.reduce((total, cell) => total + at(state.values, cell), 0) === sum,
  );
}

/**
 * Califica el puzzle desde sus números iniciales. Exige una estructura válida (`validateStructure`);
 * si no, lanza `RangeError`. Determinista.
 */
export function grade(puzzle: KillerPuzzle, { trace = false }: GradeOptions = {}): GradeResult {
  const context = graderContextOf(puzzle);
  const state = createGraderState(context);
  const stepsByLevel = new Array<number>(MAX_TECHNIQUE_LEVEL + 1).fill(0);
  const steps: GradeStep[] = [];
  let count = 0;
  let maxLevel = 0;
  while (state.unplaced > 0 && !state.contradiction) {
    const step = nextStep(context, state);
    if (!step) break;
    count++;
    stepsByLevel[step.level] = at(stepsByLevel, step.level) + 1;
    maxLevel = Math.max(maxLevel, step.level);
    if (trace) steps.push(step);
  }
  // Colocar quita el dígito de los pares, así que un tablero lleno no repite dígitos; falta ver que
  // las sumas cuadren (un puzzle sin solución podría llenarse con singles).
  if (state.unplaced === 0 && !cageSumsHold(context, state)) state.contradiction = true;

  const status: GradeStatus = state.contradiction
    ? "contradiction"
    : state.unplaced === 0
      ? "solved"
      : "exceedsTechniques";
  return {
    status,
    maxLevel: status === "solved" ? Math.max(maxLevel, 1) : UNRATED,
    steps: count,
    stepsByLevel,
    unplaced: state.unplaced,
    ...(trace ? { trace: steps } : {}),
  };
}

/** Lo que ve `levelToDeduce`: el puzzle y los dígitos colocados (nunca las notas). */
export interface BoardState {
  readonly puzzle: KillerPuzzle;
  /** `size²` dígitos de 0 a `size`, 0 si la celda está vacía. Los números iniciales se aplican igual. */
  readonly values: readonly number[];
}

/**
 * Nivel mínimo de técnica con el que `cell` queda determinada (un solo candidato) desde los dígitos
 * colocados, entre 1 y `UNRATED`. Las técnicas se aplican de menor a mayor nivel como en `grade`:
 * se usa un nivel solo cuando los inferiores no deducen nada más, así que el nivel más alto usado
 * hasta determinar la celda es el mínimo. Si el estado es contradictorio, devuelve `UNRATED`.
 * Lanza `RangeError` si la celda no existe o ya tiene un dígito.
 */
export function levelToDeduce(cell: number, { puzzle, values }: BoardState): number {
  const context = graderContextOf(puzzle);
  if (!Number.isInteger(cell) || cell < 0 || cell >= context.cellCount) {
    throw new RangeError(`Invalid cell ${String(cell)}`);
  }
  if (values.length !== context.cellCount) {
    throw new RangeError(`Expected ${String(context.cellCount)} values`);
  }
  const state = createGraderState(context, values);
  if (at(state.values, cell) !== 0) throw new RangeError(`Cell ${String(cell)} is already placed`);

  let level = 1;
  while (!state.contradiction) {
    if (popcount(at(state.candidates, cell)) === 1) return level;
    const step = nextStep(context, state);
    if (!step) break;
    level = Math.max(level, step.level);
  }
  return UNRATED;
}
