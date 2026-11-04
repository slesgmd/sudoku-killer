// Aleatorio (SPEC, R-43): un color por jaula, sin vecinas iguales, que depende solo del `id` del
// puzzle: es el mismo tras recargar o reconectar. Es local y no sale del navegador.
import { cageIndexByCell, layoutOf } from "@sudoku-killer/engine/model";
import type { PublicPuzzle } from "@sudoku-killer/protocol";
import { PALETTE_SIZE } from "./color-prefs.ts";

/** Hash FNV-1a de 32 bits. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Los colores de la paleta (de 1 a 9), en un orden que depende solo del `id`. */
export function paletteOrder(id: string): number[] {
  const order = Array.from({ length: PALETTE_SIZE }, (_, i) => i + 1);
  // Xorshift de 32 bits: no admite un estado 0.
  let state = fnv1a(id) || 1;
  for (let i = order.length - 1; i > 0; i--) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const j = state % (i + 1);
    const a = order[i] ?? 0;
    order[i] = order[j] ?? 0;
    order[j] = a;
  }
  return order;
}

/** Las jaulas vecinas de cada jaula (por su índice en `puzzle.cages`): las que comparten un lado. */
export function cageNeighbours(puzzle: PublicPuzzle): number[][] {
  const { size } = puzzle;
  const cageOf = cageIndexByCell(layoutOf(puzzle).cellCount, puzzle.cages);
  const sets = puzzle.cages.map(() => new Set<number>());
  const link = (a: number | undefined, b: number | undefined) => {
    if (a === undefined || b === undefined || a === b) return;
    sets[a]?.add(b);
    sets[b]?.add(a);
  };
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const cell = row * size + col;
      if (col + 1 < size) link(cageOf[cell], cageOf[cell + 1]);
      if (row + 1 < size) link(cageOf[cell], cageOf[cell + size]);
    }
  }
  return sets.map((set) => [...set]);
}

/**
 * Coloreado en orden de degeneración: se quita siempre el vértice de menor grado restante (a igual
 * grado, el de menor índice) y se colorea en orden inverso, con el primer color libre de `order`.
 *
 * Las jaulas son conexas (`validateStructure`), así que el grafo es plano y su degeneración es como
 * máximo 5: cada vértice tiene como máximo 5 vecinos ya coloreados y bastan 6 colores. Devuelve `null`
 * si faltaran colores, lo que con un grafo plano no ocurre (T-43.1).
 */
export function colorGraph(
  neighbours: readonly (readonly number[])[],
  order: readonly number[],
): number[] | null {
  const degree = neighbours.map((list) => list.length);
  const removed = neighbours.map(() => false);
  const removal: number[] = [];
  while (removal.length < neighbours.length) {
    let best = -1;
    degree.forEach((value, vertex) => {
      if (!removed[vertex] && (best < 0 || value < (degree[best] ?? 0))) best = vertex;
    });
    removed[best] = true;
    removal.push(best);
    for (const other of neighbours[best] ?? []) degree[other] = (degree[other] ?? 0) - 1;
  }
  const colors = neighbours.map(() => 0);
  for (const vertex of removal.reverse()) {
    const used = new Set((neighbours[vertex] ?? []).map((other) => colors[other]));
    const free = order.find((color) => !used.has(color));
    if (free === undefined) return null;
    colors[vertex] = free;
  }
  return colors;
}

/** El color de cada jaula, por su índice en `puzzle.cages`, o `null` si faltaran colores. */
export function cageColors(puzzle: PublicPuzzle): number[] | null {
  return colorGraph(cageNeighbours(puzzle), paletteOrder(puzzle.id));
}
