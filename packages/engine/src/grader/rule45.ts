// Nivel 3: regla del 45 (innies y outies). Los grupos con suma conocida salen del contexto.
import { at } from "../model/at.ts";
import { digitBit, digitsOf, popcount } from "../model/mask.ts";
import { cachedSumSupport, sumBounds } from "./sum-group.ts";
import type { Deduction, Technique } from "./types.ts";

/** Con hasta tantas celdas sin resolver, un grupo se filtra con todas sus asignaciones. */
export const MAX_EXACT_UNRESOLVED = 5;

/**
 * Innies y outies: cada grupo de la regla del 45 se trata como una jaula virtual. Si le queda una
 * celda sin resolver, vale la suma menos las demás; con pocas, se quitan los candidatos que no
 * aparecen en ninguna asignación (sin repetir dígito entre pares); con muchas, se aplican cotas de
 * suma.
 */
export const innieOutie: Technique = {
  id: "innieOutie",
  level: 3,
  find: (context, state) => {
    const { candidates } = state;
    const deductions: Deduction[] = [];
    const placed = new Set<number>();
    const eliminated = new Set<number>();
    const firstKey = context.cages.length;
    context.sumGroups.forEach((group, index) => {
      let unresolved = 0;
      let last = -1;
      let remaining = group.sum;
      for (const cell of group.cells) {
        const mask = at(candidates, cell);
        if (popcount(mask) === 1) {
          remaining -= 32 - Math.clz32(mask);
        } else {
          unresolved++;
          last = cell;
        }
      }
      if (unresolved === 0) return;

      if (unresolved === 1) {
        if (remaining < 1 || remaining > context.size || placed.has(last)) return;
        if ((at(candidates, last) & digitBit(remaining)) === 0) return;
        placed.add(last);
        deductions.push({ kind: "place", cell: last, digit: remaining });
        return;
      }

      const allowed =
        unresolved <= MAX_EXACT_UNRESOLVED
          ? cachedSumSupport(context, candidates, firstKey + index, group.cells, group.sum, false)
              .support
          : sumBounds(candidates, group.cells, group.sum);
      group.cells.forEach((cell, i) => {
        for (const digit of digitsOf(at(candidates, cell) & ~at(allowed, i))) {
          const key = cell * 32 + digit;
          if (eliminated.has(key)) continue;
          eliminated.add(key);
          deductions.push({ kind: "eliminate", cell, digit });
        }
      });
    });
    return deductions;
  },
};
