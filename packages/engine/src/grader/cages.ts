// Nivel 2: combinaciones obligatorias de jaula. Cada jaula se mira sola, con sus candidatos.
import { at } from "../model/at.ts";
import { digitBit, digitsOf } from "../model/mask.ts";
import type { GraderContext } from "./context.ts";
import type { GraderState } from "./state.ts";
import { cachedSumSupport } from "./sum-group.ts";
import type { Deduction, Technique } from "./types.ts";

/**
 * Combinaciones de jaula: un candidato que no aparece en ninguna forma de llenar la jaula con su
 * suma y sin repetir dígito sale de la celda (por ejemplo, una jaula de 2 celdas con suma 3 solo
 * admite 1 y 2).
 */
export const cageCombination: Technique = {
  id: "cageCombination",
  level: 2,
  find: (context, state) => {
    const deductions: Deduction[] = [];
    context.cages.forEach((cage, key) => {
      const { cells, sum } = cage;
      const { support } = cachedSumSupport(context, state.candidates, key, cells, sum, true);
      cells.forEach((cell, i) => {
        for (const digit of digitsOf(at(state.candidates, cell) & ~at(support, i))) {
          deductions.push({ kind: "eliminate", cell, digit });
        }
      });
    });
    return deductions;
  },
};

/**
 * Dígitos obligatorios de una jaula (los que están en todas sus combinaciones posibles). Si solo
 * una celda de la jaula lo admite, va ahí; si no, sale de las celdas de fuera de la jaula que ven
 * todas las que lo admiten.
 */
export const cageForcedDigit: Technique = {
  id: "cageForcedDigit",
  level: 2,
  find: (context, state) => {
    const deductions: Deduction[] = [];
    const placed = new Set<number>();
    const eliminated = new Set<number>();
    context.cages.forEach((cage, key) => {
      const { cells, sum } = cage;
      const { required } = cachedSumSupport(context, state.candidates, key, cells, sum, true);
      for (const digit of digitsOf(required)) {
        forcedDigit(context, state, cells, digit, deductions, placed, eliminated);
      }
    });
    return deductions;
  },
};

function forcedDigit(
  context: GraderContext,
  state: GraderState,
  cells: readonly number[],
  digit: number,
  deductions: Deduction[],
  placed: Set<number>,
  eliminated: Set<number>,
): void {
  const bit = digitBit(digit);
  const holders = cells.filter((cell) => (at(state.candidates, cell) & bit) !== 0);
  if (holders.some((cell) => at(state.values, cell) === digit)) return;
  const [first] = holders;
  if (first === undefined) return;
  if (holders.length === 1) {
    if (!placed.has(first)) deductions.push({ kind: "place", cell: first, digit });
    placed.add(first);
    return;
  }
  const { cellCount, isPeer } = context;
  for (const peer of at(context.peers, first)) {
    if ((at(state.candidates, peer) & bit) === 0 || cells.includes(peer)) continue;
    if (!holders.every((holder) => at(isPeer, holder * cellCount + peer) === 1)) continue;
    const key = peer * 32 + digit;
    if (eliminated.has(key)) continue;
    eliminated.add(key);
    deductions.push({ kind: "eliminate", cell: peer, digit });
  }
}
