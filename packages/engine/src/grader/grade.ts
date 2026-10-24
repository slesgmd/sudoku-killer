// Calificador humano (F4e y F4f, SPEC R-35): resuelve con técnicas por niveles, siempre con la de menor
// nivel que encuentre algo, y nunca adivina. `levelToDeduce` da el nivel mínimo con el que una celda
// queda determinada desde un estado (F6 lo usa para puntuar).
import type { KillerPuzzle } from "../types.ts";
import { at } from "../model/at.ts";
import { popcount } from "../model/mask.ts";
import { cageCombination, cageForcedDigit } from "./cages.ts";
import { graderContextOf, type GraderContext } from "./context.ts";
import { swordfish, xWing, yWing } from "./fish.ts";
import { cageUnitLock, lockedCandidates } from "./interactions.ts";
import { innieOutie } from "./rule45.ts";
import { cageLastCell, hiddenSingle, nakedSingle } from "./singles.ts";
import { hiddenPair, hiddenTriple, nakedPair, nakedTriple } from "./subsets.ts";
import { unitCombinationWithin, type UnitCombinationBound } from "./unit-combination.ts";
import { applyDeduction, createGraderState, type GraderState } from "./state.ts";
import { MAX_TECHNIQUE_LEVEL, UNRATED, type Deduction, type Technique } from "./types.ts";

/**
 * Cambia cuando un cambio del calificador altera el nivel o los pasos de algún puzzle. "1" fue el
 * de F4f (`unitCombination` sin cota); "2" acota `unitCombination` (F5).
 */
export const GRADER_VERSION = "2";

/** Cota de `unitCombination` en `TECHNIQUES` (elegida en F5, `docs/dificultad.md`). */
export const UNIT_COMBINATION_BOUND: UnitCombinationBound = {
  maxOpenCages: 4,
  maxCombinations: 8,
};

/** Técnicas por nivel; dentro de un nivel, en el orden en que se prueban. */
export const TECHNIQUES: readonly Technique[] = [
  nakedSingle,
  hiddenSingle,
  cageLastCell,
  cageCombination,
  cageForcedDigit,
  innieOutie,
  lockedCandidates,
  nakedPair,
  hiddenPair,
  cageUnitLock,
  nakedTriple,
  hiddenTriple,
  xWing,
  yWing,
  swordfish,
  unitCombinationWithin(UNIT_COMBINATION_BOUND),
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
  /**
   * Técnicas, de menor a mayor nivel; por defecto `TECHNIQUES`. Otra lista sirve solo para medir
   * (por ejemplo, otra cota de `unitCombination`).
   */
  readonly techniques?: readonly Technique[];
}

/**
 * Busca la primera técnica, de menor a mayor nivel, que encuentra deducciones, sin aplicarlas.
 * Devuelve el paso, o `null` si ninguna técnica encuentra nada.
 */
function findStep(
  context: GraderContext,
  state: GraderState,
  techniques: readonly Technique[],
): GradeStep | null {
  for (const technique of techniques) {
    const deductions = technique.find(context, state);
    if (deductions.length > 0)
      return { technique: technique.id, level: technique.level, deductions };
  }
  return null;
}

/** `findStep` y aplica todas sus deducciones. */
function nextStep(
  context: GraderContext,
  state: GraderState,
  techniques: readonly Technique[],
): GradeStep | null {
  const step = findStep(context, state, techniques);
  if (step) for (const deduction of step.deductions) applyDeduction(context, state, deduction);
  return step;
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
export function grade(
  puzzle: KillerPuzzle,
  { trace = false, techniques = TECHNIQUES }: GradeOptions = {},
): GradeResult {
  const context = graderContextOf(puzzle);
  const state = createGraderState(context);
  const stepsByLevel = new Array<number>(MAX_TECHNIQUE_LEVEL + 1).fill(0);
  const steps: GradeStep[] = [];
  let count = 0;
  let maxLevel = 0;
  while (state.unplaced > 0 && !state.contradiction) {
    const step = nextStep(context, state, techniques);
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

/** Un dígito descartado en una celda (F6): el de un error, que es público (`cell.mistake`). */
export interface Exclusion {
  readonly cell: number;
  readonly digit: number;
}

/** Lo que ve `levelToDeduce`: el puzzle, los dígitos colocados y los descartes (nunca las notas). */
export interface BoardState {
  readonly puzzle: KillerPuzzle;
  /** `size²` dígitos de 0 a `size`, 0 si la celda está vacía. Los números iniciales se aplican igual. */
  readonly values: readonly number[];
  /**
   * Dígitos descartados por errores públicos (F6). Un error nunca es el dígito de la solución, así
   * que descartarlo no la contradice, y con más descartes el nivel no sube.
   */
  readonly excluded?: readonly Exclusion[];
}

/** Estado del calificador para `board`, con sus descartes. Lanza `RangeError` si no es válido. */
function boardGraderState(
  context: GraderContext,
  { values, excluded = [] }: BoardState,
): GraderState {
  if (values.length !== context.cellCount) {
    throw new RangeError(`Expected ${String(context.cellCount)} values`);
  }
  const state = createGraderState(context, values);
  for (const { cell, digit } of excluded) {
    if (!Number.isInteger(cell) || cell < 0 || cell >= context.cellCount) {
      throw new RangeError(`Invalid excluded cell ${String(cell)}`);
    }
    if (!Number.isInteger(digit) || digit < 1 || digit > context.size) {
      throw new RangeError(`Invalid excluded digit ${String(digit)}`);
    }
    applyDeduction(context, state, { kind: "eliminate", cell, digit });
  }
  return state;
}

/**
 * Nivel mínimo de técnica con el que `cell` queda determinada (un solo candidato) desde los dígitos
 * colocados y los descartes, entre 1 y `UNRATED`. Las técnicas se aplican de menor a mayor nivel
 * como en `grade`: se usa un nivel solo cuando los inferiores no deducen nada más, así que el nivel
 * más alto usado hasta determinar la celda es el mínimo. Si el estado es contradictorio, devuelve
 * `UNRATED`. Lanza `RangeError` si la celda no existe o ya tiene un dígito.
 */
export function levelToDeduce(cell: number, board: BoardState): number {
  return levelToDeduceWith(TECHNIQUES, cell, board);
}

/** `levelToDeduce` con otra lista de técnicas. Interno: solo para medir. */
export function levelToDeduceWith(
  techniques: readonly Technique[],
  cell: number,
  board: BoardState,
): number {
  const context = graderContextOf(board.puzzle);
  if (!Number.isInteger(cell) || cell < 0 || cell >= context.cellCount) {
    throw new RangeError(`Invalid cell ${String(cell)}`);
  }
  const state = boardGraderState(context, board);
  if (at(state.values, cell) !== 0) throw new RangeError(`Cell ${String(cell)} is already placed`);

  let level = 1;
  while (!state.contradiction) {
    if (popcount(at(state.candidates, cell)) === 1) return level;
    const step = nextStep(context, state, techniques);
    if (!step) break;
    level = Math.max(level, step.level);
  }
  return UNRATED;
}

/** Lo que da `levelsToDeduce`: los niveles de todas las celdas y los puntos fijos por nivel. */
export interface BoardLevels {
  /** `levelToDeduce` de cada celda vacía; 0 en las que ya tienen un dígito. */
  readonly levels: readonly number[];
  /**
   * `fixpoints[L]`: los candidatos en el punto fijo de las técnicas de nivel ≤ L desde el estado,
   * para L de 1 a `MAX_TECHNIQUE_LEVEL`; `fixpoints[0]` son los del estado, sin técnicas. Una celda
   * vacía tiene un solo candidato en `fixpoints[L]` si y solo si su nivel es ≤ L.
   */
  readonly fixpoints: readonly Uint16Array[];
}

/**
 * `levelToDeduce` de todas las celdas en una sola pasada (F6, para el simulador). La secuencia de
 * pasos no depende de la celda pedida (`levelToDeduce` solo corta antes), así que el nivel de cada
 * celda es el más alto usado hasta que queda con un solo candidato. Antes del primer paso de nivel
 * mayor que L, el estado es el punto fijo de los niveles ≤ L.
 */
export function levelsToDeduce(board: BoardState): BoardLevels {
  const context = graderContextOf(board.puzzle);
  const state = boardGraderState(context, board);
  const levels = new Array<number>(context.cellCount).fill(0);
  const fixpoints: Uint16Array[] = [state.candidates.slice()];
  let pending: number[] = [];
  for (let cell = 0; cell < context.cellCount; cell++) {
    if (at(state.values, cell) === 0) pending.push(cell);
  }

  let level = 1;
  // Como `levelToDeduce`: se mira cada celda antes de cada paso, y un paso que deja el estado
  // contradictorio no determina ninguna.
  while (!state.contradiction) {
    pending = pending.filter((cell) => {
      if (popcount(at(state.candidates, cell)) !== 1) return true;
      levels[cell] = level;
      return false;
    });
    if (pending.length === 0) break;
    const step = findStep(context, state, TECHNIQUES);
    if (!step) break;
    while (fixpoints.length < step.level) fixpoints.push(state.candidates.slice());
    for (const deduction of step.deductions) applyDeduction(context, state, deduction);
    level = Math.max(level, step.level);
  }
  for (const cell of pending) levels[cell] = UNRATED;
  // Los niveles sin un paso mayor tienen como punto fijo el estado final. Si la pasada cortó porque
  // todas las celdas tienen un solo candidato, sus máscaras ya no cambian sin contradicción.
  while (fixpoints.length <= MAX_TECHNIQUE_LEVEL) fixpoints.push(state.candidates.slice());
  return { levels, fixpoints };
}
