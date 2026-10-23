// Nivel 4: pares y tríos, desnudos y ocultos. Los grupos son las filas, columnas y cajas, y las
// jaulas (sus celdas no repiten dígito).
import { at } from "../model/at.ts";
import { digitBit, digitsOf, popcount } from "../model/mask.ts";
import type { GraderContext } from "./context.ts";
import type { GraderState } from "./state.ts";
import { cachedSumSupport } from "./sum-group.ts";
import type { Deduction, Technique, TechniqueId } from "./types.ts";

/** Combinaciones de `k` elementos de `items`, en orden lexicográfico. */
export function* combinations<T>(items: readonly T[], k: number, start = 0): Generator<T[]> {
  if (k === 0) {
    yield [];
    return;
  }
  for (let i = start; i <= items.length - k; i++) {
    for (const rest of combinations(items, k - 1, i + 1)) yield [at(items, i), ...rest];
  }
}

/** Recoge eliminaciones sin repetir (celda, dígito) ni quitar un candidato que ya no está. */
export function eliminationCollector(state: GraderState): {
  readonly deductions: Deduction[];
  readonly eliminate: (cell: number, mask: number) => void;
} {
  const deductions: Deduction[] = [];
  const seen = new Set<number>();
  const eliminate = (cell: number, mask: number): void => {
    for (const digit of digitsOf(at(state.candidates, cell) & mask)) {
      const key = cell * 32 + digit;
      if (seen.has(key)) continue;
      seen.add(key);
      deductions.push({ kind: "eliminate", cell, digit });
    }
  };
  return { deductions, eliminate };
}

/** Dígitos colocados en `cells`. */
export function placedIn(state: GraderState, cells: readonly number[]): number {
  let placed = 0;
  for (const cell of cells) {
    const value = at(state.values, cell);
    if (value !== 0) placed |= digitBit(value);
  }
  return placed;
}

/** Grupos de celdas que no repiten dígito: unidades y jaulas. */
function distinctGroups(context: GraderContext): readonly (readonly number[])[] {
  return [...context.units, ...context.cages.map((cage) => cage.cells)];
}

/**
 * Subconjunto desnudo: `k` celdas vacías de un grupo cuyos candidatos juntos son `k` dígitos. Esos
 * dígitos van en esas celdas, así que salen de toda celda que las vea a todas.
 */
function nakedSubset(id: TechniqueId, k: number): Technique {
  return {
    id,
    level: 4,
    find: (context, state) => {
      const { candidates, values } = state;
      const { cellCount, isPeer } = context;
      const { deductions, eliminate } = eliminationCollector(state);
      for (const group of distinctGroups(context)) {
        const open = group.filter((cell) => {
          const count = popcount(at(candidates, cell));
          return at(values, cell) === 0 && count >= 2 && count <= k;
        });
        for (const subset of combinations(open, k)) {
          let union = 0;
          for (const cell of subset) union |= at(candidates, cell);
          if (popcount(union) !== k) continue;
          const [first] = subset;
          if (first === undefined) continue;
          for (const peer of at(context.peers, first)) {
            if (subset.includes(peer)) continue;
            if (subset.every((cell) => at(isPeer, cell * cellCount + peer) === 1)) {
              eliminate(peer, union);
            }
          }
        }
      }
      return deductions;
    },
  };
}

/**
 * Subconjunto oculto: `k` dígitos que un grupo tiene que usar y que solo caben en `k` de sus celdas.
 * Esas celdas son de esos dígitos, así que pierden los demás candidatos. Una fila, columna o caja
 * usa todos los dígitos; una jaula, los obligatorios de sus combinaciones.
 */
function hiddenSubset(id: TechniqueId, k: number): Technique {
  return {
    id,
    level: 4,
    find: (context, state) => {
      const { candidates, values } = state;
      const { deductions, eliminate } = eliminationCollector(state);
      const groups = context.units.map((cells) => ({ cells, digits: context.full }));
      context.cages.forEach(({ cells, sum }, key) => {
        const { required } = cachedSumSupport(context, candidates, key, cells, sum, true);
        groups.push({ cells, digits: required });
      });
      for (const { cells, digits } of groups) {
        // Posiciones de cada dígito que falta, como máscara de índices dentro del grupo.
        const spots: { digit: number; where: number }[] = [];
        for (const digit of digitsOf(digits & ~placedIn(state, cells))) {
          let where = 0;
          cells.forEach((cell, i) => {
            if (at(values, cell) === 0 && (at(candidates, cell) & digitBit(digit)) !== 0) {
              where |= 1 << i;
            }
          });
          const count = popcount(where);
          if (count >= 2 && count <= k) spots.push({ digit, where });
        }
        for (const subset of combinations(spots, k)) {
          let where = 0;
          let mask = 0;
          for (const spot of subset) {
            where |= spot.where;
            mask |= digitBit(spot.digit);
          }
          if (popcount(where) !== k) continue;
          cells.forEach((cell, i) => {
            if ((where & (1 << i)) !== 0) eliminate(cell, ~mask);
          });
        }
      }
      return deductions;
    },
  };
}

export const nakedPair = nakedSubset("nakedPair", 2);
export const nakedTriple = nakedSubset("nakedTriple", 3);
export const hiddenPair = hiddenSubset("hiddenPair", 2);
export const hiddenTriple = hiddenSubset("hiddenTriple", 3);
