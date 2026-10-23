// Estado del calificador: candidatos y dígitos colocados. Colocar un dígito lo quita de los
// candidatos de sus pares (fila, columna, caja y jaula), como en la limpieza automática de notas.
import { at } from "../model/at.ts";
import { digitBit } from "../model/mask.ts";
import type { GraderContext } from "./context.ts";
import type { Deduction } from "./types.ts";

export interface GraderState {
  /** Máscara de candidatos de cada celda; la de una celda colocada es su dígito. */
  readonly candidates: Uint16Array;
  /** Dígito colocado en cada celda, o 0. */
  readonly values: Uint8Array;
  unplaced: number;
  /** Alguna celda se quedó sin candidatos o se colocó un dígito incompatible. */
  contradiction: boolean;
}

/**
 * Estado con los números iniciales y los dígitos de `values` (`size²` dígitos de 0 a `size`, 0 si
 * la celda está vacía) colocados. Lanza `RangeError` si `values` no tiene esa forma.
 */
export function createGraderState(
  context: GraderContext,
  values: readonly number[] = [],
): GraderState {
  const { cellCount, size, full } = context;
  if (values.length !== 0 && values.length !== cellCount) {
    throw new RangeError(`Expected ${String(cellCount)} values, got ${String(values.length)}`);
  }
  const state: GraderState = {
    candidates: new Uint16Array(cellCount).fill(full),
    values: new Uint8Array(cellCount),
    unplaced: cellCount,
    contradiction: false,
  };
  for (const { cell, value } of context.puzzle.givens) {
    applyDeduction(context, state, { kind: "place", cell, digit: value });
  }
  values.forEach((value, cell) => {
    if (!Number.isInteger(value) || value < 0 || value > size) {
      throw new RangeError(`Invalid value ${String(value)} at cell ${String(cell)}`);
    }
    if (value !== 0) applyDeduction(context, state, { kind: "place", cell, digit: value });
  });
  return state;
}

export function cloneGraderState(state: GraderState): GraderState {
  return {
    candidates: state.candidates.slice(),
    values: state.values.slice(),
    unplaced: state.unplaced,
    contradiction: state.contradiction,
  };
}

/** Aplica una deducción. Marca `contradiction` si deja una celda sin candidatos. */
export function applyDeduction(
  context: GraderContext,
  state: GraderState,
  deduction: Deduction,
): void {
  const { cell, digit } = deduction;
  const bit = digitBit(digit);
  const { candidates, values } = state;
  if (deduction.kind === "eliminate") {
    const mask = at(candidates, cell);
    if ((mask & bit) === 0) return;
    candidates[cell] = mask & ~bit;
    if (mask === bit) state.contradiction = true;
    return;
  }

  const placed = at(values, cell);
  if (placed !== 0) {
    if (placed !== digit) state.contradiction = true;
    return;
  }
  if ((at(candidates, cell) & bit) === 0) state.contradiction = true;
  values[cell] = digit;
  candidates[cell] = bit;
  state.unplaced--;
  for (const peer of at(context.peers, cell)) {
    const mask = at(candidates, peer);
    if ((mask & bit) === 0) continue;
    candidates[peer] = mask & ~bit;
    if (mask === bit) state.contradiction = true;
  }
}
