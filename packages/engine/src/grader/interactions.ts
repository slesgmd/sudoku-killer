// Nivel 4: interacciones entre unidades y jaulas (locked candidates).
import { at } from "../model/at.ts";
import { digitBit } from "../model/mask.ts";
import type { GraderContext } from "./context.ts";
import type { GraderState } from "./state.ts";
import { cachedSumSupport, sumSupport } from "./sum-group.ts";
import { eliminationCollector, placedIn } from "./subsets.ts";
import type { Technique } from "./types.ts";

/**
 * Celdas vacías de `unit` que admiten `digit`, o `null` si el dígito ya está colocado en la unidad.
 */
function holdersIn(state: GraderState, unit: readonly number[], digit: number): number[] | null {
  const bit = digitBit(digit);
  const holders: number[] = [];
  for (const cell of unit) {
    const value = at(state.values, cell);
    if (value === digit) return null;
    if (value === 0 && (at(state.candidates, cell) & bit) !== 0) holders.push(cell);
  }
  return holders;
}

/**
 * Locked candidates: un dígito que una fila, columna o caja tiene que usar, y que solo cabe en
 * celdas que ve otra celda, sale de esa celda (pointing y claiming entre caja y línea, y también
 * con las jaulas, porque sus celdas son pares).
 */
export const lockedCandidates: Technique = {
  id: "lockedCandidates",
  level: 4,
  find: (context, state) => {
    const { cellCount, isPeer } = context;
    const { deductions, eliminate } = eliminationCollector(state);
    for (const unit of context.units) {
      for (let digit = 1; digit <= context.size; digit++) {
        const holders = holdersIn(state, unit, digit);
        const first = holders?.[0];
        if (!holders || holders.length < 2 || first === undefined) continue;
        for (const peer of at(context.peers, first)) {
          if (holders.includes(peer) || at(state.values, peer) !== 0) continue;
          if (holders.every((cell) => at(isPeer, cell * cellCount + peer) === 1)) {
            eliminate(peer, digitBit(digit));
          }
        }
      }
    }
    return deductions;
  },
};

/**
 * Jaula obligada por una unidad: si en una fila, columna o caja un dígito solo cabe en celdas de
 * una misma jaula, esa jaula tiene que usarlo, y se descartan sus combinaciones sin él.
 */
export const cageUnitLock: Technique = {
  id: "cageUnitLock",
  level: 4,
  find: (context, state) => {
    const { deductions, eliminate } = eliminationCollector(state);
    cageDigitsForcedByUnits(context, state).forEach((digits, key) => {
      if (digits === 0) return;
      const { cells, sum } = at(context.cages, key);
      const { support } = sumSupport(context, state.candidates, cells, sum, false, digits);
      cells.forEach((cell, i) => {
        eliminate(cell, ~at(support, i));
      });
    });
    return deductions;
  },
};

/**
 * Por jaula, los dígitos que alguna unidad la obliga a usar, sin los que ya tiene colocados ni los
 * que sus combinaciones ya exigen (con esos, el filtro no deduce nada nuevo).
 */
function cageDigitsForcedByUnits(context: GraderContext, state: GraderState): number[] {
  const mustUse = new Array<number>(context.cages.length).fill(0);
  for (const unit of context.units) {
    for (let digit = 1; digit <= context.size; digit++) {
      const holders = holdersIn(state, unit, digit);
      const first = holders?.[0];
      if (!holders || first === undefined) continue;
      const cage = at(context.cageOf, first);
      if (holders.every((cell) => at(context.cageOf, cell) === cage)) {
        mustUse[cage] = at(mustUse, cage) | digitBit(digit);
      }
    }
  }
  return mustUse.map((digits, key) => {
    if (digits === 0) return 0;
    const { cells, sum } = at(context.cages, key);
    const { required } = cachedSumSupport(context, state.candidates, key, cells, sum, true);
    return digits & ~required & ~placedIn(state, cells);
  });
}
