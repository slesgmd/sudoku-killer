// Consultas sobre el tablero de una partida que comparten el reductor, `decide` y el cliente.
import { cageIndexByCell, layoutOf } from "@sudoku-killer/engine";
import type { ClosedUnit } from "@sudoku-killer/scoring";
import type { NoteLayer, PublicPuzzle } from "@sudoku-killer/protocol";
import type { CellState, PlayerId } from "./types.ts";

/** Clave de un candidato en `lastNoteOp` (SPEC §2.3). */
export function noteKey(
  layer: NoteLayer,
  ownerId: PlayerId | null,
  cell: number,
  digit: number,
): string {
  return layer === "group"
    ? `group:${String(cell)}:${String(digit)}`
    : `personal:${ownerId ?? ""}:${String(cell)}:${String(digit)}`;
}

/** Dígito de cada celda, 0 si está vacía (el `values` de `levelToDeduce`). */
export function valuesOf(cells: readonly CellState[]): number[] {
  return cells.map((cell) => (cell.status === "locked" ? cell.value : 0));
}

/**
 * Unidades que quedan completas si se bloquea `cell` (las demás celdas ya bloqueadas), en el orden
 * fila, columna, caja y jaula. El índice de la jaula es su `id`.
 */
export function closedUnitsOf(
  puzzle: PublicPuzzle,
  cells: readonly CellState[],
  cell: number,
): ClosedUnit[] {
  const layout = layoutOf(puzzle);
  const lockedOrSelf = (other: number) => other === cell || cells[other]?.status === "locked";
  const units: ClosedUnit[] = [];
  const row = layout.rowOf[cell];
  const col = layout.colOf[cell];
  const box = layout.boxOf[cell];
  if (row !== undefined && layout.rows[row]?.every(lockedOrSelf))
    units.push({ unit: "row", index: row });
  if (col !== undefined && layout.cols[col]?.every(lockedOrSelf))
    units.push({ unit: "col", index: col });
  if (box !== undefined && layout.boxes[box]?.every(lockedOrSelf))
    units.push({ unit: "box", index: box });
  const cage = puzzle.cages[cageIndexByCell(layout.cellCount, puzzle.cages)[cell] ?? -1];
  if (cage?.cells.every(lockedOrSelf)) units.push({ unit: "cage", index: cage.id });
  return units;
}

/** Cuántas celdas tiene el tablero. */
export function cellCountOf(puzzle: Pick<PublicPuzzle, "size">): number {
  return puzzle.size * puzzle.size;
}
