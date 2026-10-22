import type { Grid, KillerPuzzle } from "../types.ts";
import { cageIndexByCell, layoutOf, peersWithCage } from "./geometry.ts";

export type SolutionIssue =
  | { readonly code: "length" }
  | { readonly code: "digit"; readonly cell: number }
  | { readonly code: "row" | "col" | "box"; readonly unit: number }
  | { readonly code: "cage-repeat" | "cage-sum"; readonly cageId: number }
  | { readonly code: "given"; readonly cell: number };

function hasRepeat(grid: Grid, cells: readonly number[]): boolean {
  const seen = new Set<number>();
  for (const cell of cells) {
    const digit = grid[cell]!;
    if (seen.has(digit)) return true;
    seen.add(digit);
  }
  return false;
}

/**
 * Comprueba una cuadrícula completa contra el puzzle (T-35.3): filas, columnas y cajas sin
 * repetir, jaulas sin repetir y con su suma, y números iniciales respetados. Supone una
 * estructura válida (`validateStructure`). Devuelve la lista de problemas; vacía si es solución.
 */
export function validateSolution(puzzle: KillerPuzzle, grid: Grid): SolutionIssue[] {
  const layout = layoutOf(puzzle);
  if (grid.length !== layout.cellCount) return [{ code: "length" }];
  const issues: SolutionIssue[] = [];

  grid.forEach((digit, cell) => {
    if (!Number.isInteger(digit) || digit < 1 || digit > puzzle.size) {
      issues.push({ code: "digit", cell });
    }
  });
  if (issues.length > 0) return issues;

  const units = [
    ["row", layout.rows],
    ["col", layout.cols],
    ["box", layout.boxes],
  ] as const;
  for (const [code, list] of units) {
    list.forEach((cells, unit) => {
      if (hasRepeat(grid, cells)) issues.push({ code, unit });
    });
  }
  for (const cage of puzzle.cages) {
    if (hasRepeat(grid, cage.cells)) issues.push({ code: "cage-repeat", cageId: cage.id });
    const sum = cage.cells.reduce((total, cell) => total + grid[cell]!, 0);
    if (sum !== cage.sum) issues.push({ code: "cage-sum", cageId: cage.id });
  }
  for (const { cell, value } of puzzle.givens) {
    if (grid[cell] !== value) issues.push({ code: "given", cell });
  }
  return issues;
}

/** Veredicto de una jugada contra la solución (R-02, R-03). */
export function checkPlacement(solution: Grid, cell: number, value: number): "correct" | "mistake" {
  const expected = solution[cell];
  if (expected === undefined) throw new RangeError(`Cell ${String(cell)} is outside the board`);
  return expected === value ? "correct" : "mistake";
}

/**
 * Error evidente (R-28, D6): el dígito repite el de una celda bloqueada de su fila, columna, caja
 * o jaula. `locked[c]` es el dígito bloqueado en `c`, o 0 si la celda está vacía.
 */
export function isEvidentMistake(
  puzzle: KillerPuzzle,
  locked: ArrayLike<number>,
  cell: number,
  value: number,
): boolean {
  const layout = layoutOf(puzzle);
  const cageIndex = cageIndexByCell(layout.cellCount, puzzle.cages)[cell] ?? -1;
  return peersWithCage(layout, puzzle.cages[cageIndex], cell).some(
    (peer) => locked[peer] === value,
  );
}
