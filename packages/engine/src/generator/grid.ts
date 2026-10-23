// Paso 1 del generador: una cuadrícula completa aleatoria.
import type { Geometry, Grid } from "../types.ts";
import { at } from "../model/at.ts";
import { layoutOf } from "../model/geometry.ts";
import { digitBit, digitsOf, fullMask, popcount } from "../model/mask.ts";
import { shuffle, type Rng } from "./rng.ts";

/**
 * Cuadrícula de sudoku completa y válida, elegida al azar con `rng`. Backtracking con MRV (la
 * celda vacía con menos candidatos; ante un empate, la de menor índice) y los candidatos en orden
 * aleatorio. En 9×9 casi nunca retrocede.
 */
export function randomGrid(geometry: Geometry, rng: Rng): Grid {
  const layout = layoutOf(geometry);
  const { size } = geometry;
  const grid = new Array<number>(layout.cellCount).fill(0);

  const candidates = (cell: number): number => {
    let mask = fullMask(size);
    for (const peer of at(layout.peers, cell)) {
      const digit = at(grid, peer);
      if (digit !== 0) mask &= ~digitBit(digit);
    }
    return mask;
  };

  const fill = (): boolean => {
    let best = -1;
    let bestMask = 0;
    let bestCount = Infinity;
    for (let cell = 0; cell < grid.length && bestCount > 1; cell++) {
      if (at(grid, cell) !== 0) continue;
      const mask = candidates(cell);
      const count = popcount(mask);
      if (count < bestCount) {
        best = cell;
        bestMask = mask;
        bestCount = count;
      }
    }
    if (best === -1) return true;
    for (const digit of shuffle(rng, digitsOf(bestMask))) {
      grid[best] = digit;
      if (fill()) return true;
    }
    grid[best] = 0;
    return false;
  };

  if (!fill()) throw new RangeError("Unreachable: every geometry has a valid grid");
  return grid;
}
