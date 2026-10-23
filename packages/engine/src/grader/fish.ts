// Nivel 5: patrones de varias unidades. X-Wing y Swordfish (peces de 2 y 3 líneas) e Y-Wing.
import { at } from "../model/at.ts";
import { digitBit, popcount } from "../model/mask.ts";
import { combinations, eliminationCollector } from "./subsets.ts";
import type { Technique, TechniqueId } from "./types.ts";

/**
 * Pez de `n` líneas: si en `n` filas un dígito solo cabe en `n` columnas, esas filas lo ponen en
 * esas columnas, así que sale del resto de cada columna. Igual cambiando filas por columnas.
 */
function fish(id: TechniqueId, n: number): Technique {
  return {
    id,
    level: 5,
    find: (context, state) => {
      const { size } = context;
      const { candidates, values } = state;
      const { deductions, eliminate } = eliminationCollector(state);
      for (let digit = 1; digit <= size; digit++) {
        const bit = digitBit(digit);
        for (const rowsAreBase of [true, false]) {
          const cellAt = (base: number, cover: number): number =>
            rowsAreBase ? base * size + cover : cover * size + base;
          // Líneas base donde falta el dígito, con las líneas que lo admiten como máscara.
          const lines: { base: number; covers: number }[] = [];
          for (let base = 0; base < size; base++) {
            let covers = 0;
            let placed = false;
            for (let cover = 0; cover < size && !placed; cover++) {
              const cell = cellAt(base, cover);
              const value = at(values, cell);
              placed = value === digit;
              if (value === 0 && (at(candidates, cell) & bit) !== 0) covers |= 1 << cover;
            }
            const count = popcount(covers);
            if (!placed && count >= 2 && count <= n) lines.push({ base, covers });
          }
          for (const subset of combinations(lines, n)) {
            let union = 0;
            for (const line of subset) union |= line.covers;
            if (popcount(union) !== n) continue;
            for (let cover = 0; cover < size; cover++) {
              if ((union & (1 << cover)) === 0) continue;
              for (let base = 0; base < size; base++) {
                const cell = cellAt(base, cover);
                if (subset.some((line) => line.base === base) || at(values, cell) !== 0) continue;
                eliminate(cell, bit);
              }
            }
          }
        }
      }
      return deductions;
    },
  };
}

export const xWing = fish("xWing", 2);
export const swordfish = fish("swordfish", 3);

/**
 * Y-Wing: una celda pivote con candidatos {a, b} ve una celda {a, c} y otra {b, c}. Si el pivote
 * es a, la segunda es c; si es b, la primera es c. Así que c sale de las celdas que ven a las dos.
 */
export const yWing: Technique = {
  id: "yWing",
  level: 5,
  find: (context, state) => {
    const { cellCount, isPeer } = context;
    const { candidates, values } = state;
    const { deductions, eliminate } = eliminationCollector(state);
    const bivalue = (cell: number): boolean =>
      at(values, cell) === 0 && popcount(at(candidates, cell)) === 2;
    for (let pivot = 0; pivot < cellCount; pivot++) {
      if (!bivalue(pivot)) continue;
      const pivotMask = at(candidates, pivot);
      const wings = at(context.peers, pivot).filter(bivalue);
      for (const x of wings) {
        const xMask = at(candidates, x);
        const shared = xMask & pivotMask;
        if (popcount(shared) !== 1) continue;
        const c = xMask & ~pivotMask;
        const yMask = (pivotMask & ~shared) | c;
        for (const y of wings) {
          if (y === x || at(candidates, y) !== yMask) continue;
          for (const cell of at(context.peers, x)) {
            if (cell === y || at(values, cell) !== 0) continue;
            if (at(isPeer, y * cellCount + cell) === 1) eliminate(cell, c);
          }
        }
      }
    }
    return deductions;
  },
};
