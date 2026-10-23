// Nivel 1: singles. Solo miran los candidatos que dejan los dígitos colocados en las unidades.
import { at } from "../model/at.ts";
import { digitBit, singleDigit } from "../model/mask.ts";
import type { Deduction, Technique } from "./types.ts";

/** Naked single: una celda vacía con un solo candidato. */
export const nakedSingle: Technique = {
  id: "nakedSingle",
  level: 1,
  find: (context, state) => {
    const deductions: Deduction[] = [];
    for (let cell = 0; cell < context.cellCount; cell++) {
      if (at(state.values, cell) !== 0) continue;
      const digit = singleDigit(at(state.candidates, cell));
      if (digit !== 0) deductions.push({ kind: "place", cell, digit });
    }
    return deductions;
  },
};

/** Hidden single: un dígito que en una fila, columna o caja cabe en una sola celda. */
export const hiddenSingle: Technique = {
  id: "hiddenSingle",
  level: 1,
  find: (context, state) => {
    const deductions: Deduction[] = [];
    const found = new Set<number>();
    for (const unit of context.units) {
      for (let digit = 1; digit <= context.size; digit++) {
        const bit = digitBit(digit);
        let only = -1;
        let count = 0;
        for (const cell of unit) {
          if ((at(state.candidates, cell) & bit) === 0) continue;
          only = cell;
          if (++count > 1) break;
        }
        if (count !== 1 || at(state.values, only) !== 0 || found.has(only)) continue;
        found.add(only);
        deductions.push({ kind: "place", cell: only, digit });
      }
    }
    return deductions;
  },
};

/** Última celda de una jaula: vale la suma menos los dígitos colocados en las demás. */
export const cageLastCell: Technique = {
  id: "cageLastCell",
  level: 1,
  find: (context, state) => {
    const deductions: Deduction[] = [];
    for (const cage of context.cages) {
      let empty = -1;
      let emptyCount = 0;
      let remaining = cage.sum;
      for (const cell of cage.cells) {
        const value = at(state.values, cell);
        if (value === 0) {
          empty = cell;
          emptyCount++;
        } else {
          remaining -= value;
        }
      }
      if (emptyCount !== 1 || remaining < 1 || remaining > context.size) continue;
      if ((at(state.candidates, empty) & digitBit(remaining)) === 0) continue;
      deductions.push({ kind: "place", cell: empty, digit: remaining });
    }
    return deductions;
  },
};
