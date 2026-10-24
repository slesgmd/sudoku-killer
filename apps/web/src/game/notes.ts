// Notas optimistas (ADR 0005), sin estado propio: lo que se ve de una capa es lo confirmado por el
// servidor más las operaciones pendientes propias, aplicadas en orden. Lo confirmado solo cambia con
// un `note.applied` (en el orden del servidor, por `seq`), con la limpieza de un bloqueo o con el
// snapshot de una reconexión; las pendientes salen de la lista con su respuesta (`note.applied`,
// `ack` o `error`) y se reenvían con el mismo `id` al volver. Así todos los clientes convergen al
// estado que define el orden del servidor (T-16.2).
import { digitBit } from "@sudoku-killer/engine/model";
import type { NoteLayer, NoteOp } from "@sudoku-killer/protocol";

export interface PendingNote {
  readonly id: string;
  readonly layer: NoteLayer;
  readonly op: NoteOp;
  readonly cell: number;
  readonly digit: number;
}

/** Una copia de `notes` con la operación aplicada. Agregar lo que está o quitar lo que no está no cambia nada. */
export function applyNoteOp(
  notes: Uint16Array,
  op: NoteOp,
  cell: number,
  digit: number,
): Uint16Array {
  const next = notes.slice();
  const bit = digitBit(digit);
  next[cell] = op === "add" ? (notes[cell] ?? 0) | bit : (notes[cell] ?? 0) & ~bit;
  return next;
}

/** Lo que se ve de una capa: lo confirmado más las pendientes de esa capa, en orden. */
export function visibleNotes(
  confirmed: Uint16Array,
  pending: readonly PendingNote[],
  layer: NoteLayer,
): Uint16Array {
  let notes = confirmed;
  for (const op of pending) {
    if (op.layer === layer) notes = applyNoteOp(notes, op.op, op.cell, op.digit);
  }
  return notes === confirmed ? confirmed.slice() : notes;
}

/** Las pendientes sin la que respondió el servidor. */
export function withoutPending(pending: readonly PendingNote[], id: string): PendingNote[] {
  return pending.filter((op) => op.id !== id);
}
