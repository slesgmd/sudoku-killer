import type { KillerPuzzle } from "../types.ts";
import { at } from "./at.ts";
import { cageIndexByCell, layoutOf, peersWithCage } from "./geometry.ts";
import { digitBit, digitsOf } from "./mask.ts";

/** Candidato quitado por una limpieza: lo usa el deshacer con comprobación (P7, ADR 0005). */
export interface NoteRemoval {
  readonly cell: number;
  readonly digit: number;
}

export interface CleanupResult {
  /** Notas nuevas; las de entrada no se modifican. */
  readonly notes: Uint16Array;
  /** Candidatos quitados, ordenados por celda y dígito. */
  readonly removed: readonly NoteRemoval[];
}

type CleanupPuzzle = Pick<KillerPuzzle, "size" | "boxRows" | "boxCols" | "cages">;

/** Vacía las notas de una celda: la celda bloqueada, en las dos capas (R-17). */
export function clearCellNotes(notes: Uint16Array, cell: number): CleanupResult {
  const next = notes.slice();
  next[cell] = 0;
  const removed = digitsOf(notes[cell] ?? 0).map((digit) => ({ cell, digit }));
  return { notes: next, removed };
}

/**
 * Limpieza automática al bloquear `cell` con `digit` (R-17, ADR 0005): quita `digit` de los pares
 * de la celda (fila, columna, caja y jaula) y vacía la celda. Es determinista: la usan igual el
 * servidor, los clientes y la reproducción del registro.
 */
export function cleanupPeers(
  puzzle: CleanupPuzzle,
  notes: Uint16Array,
  cell: number,
  digit: number,
): CleanupResult {
  const layout = layoutOf(puzzle);
  if (notes.length !== layout.cellCount) throw new RangeError("Notes do not match the board");
  const cageIndex = cageIndexByCell(layout.cellCount, puzzle.cages)[cell] ?? -1;
  const bit = digitBit(digit);
  const cleared = clearCellNotes(notes, cell);
  const next = cleared.notes;
  const removed = [...cleared.removed];

  for (const peer of peersWithCage(layout, puzzle.cages[cageIndex], cell)) {
    const mask = at(next, peer);
    if (mask & bit) {
      next[peer] = mask & ~bit;
      removed.push({ cell: peer, digit });
    }
  }
  removed.sort((a, b) => a.cell - b.cell || a.digit - b.digit);
  return { notes: next, removed };
}
