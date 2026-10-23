import type { KillerPuzzle } from "../types.ts";
import { at } from "./at.ts";
import { isValidGeometry, layoutOf } from "./geometry.ts";

export const MIN_CAGE_SIZE = 2;
export const MAX_CAGE_SIZE = 5;

export type StructureIssue =
  | { readonly code: "geometry" }
  | { readonly code: "cage-id-duplicate"; readonly cageId: number }
  | { readonly code: "cage-size"; readonly cageId: number }
  | { readonly code: "cage-cell-out-of-range"; readonly cageId: number; readonly cell: number }
  | { readonly code: "cage-overlap"; readonly cageId: number; readonly cell: number }
  | { readonly code: "cage-disconnected"; readonly cageId: number }
  | { readonly code: "cage-sum-unreachable"; readonly cageId: number }
  | { readonly code: "cell-uncovered"; readonly cell: number }
  | { readonly code: "given-invalid"; readonly cell: number }
  | { readonly code: "given-duplicate-cell"; readonly cell: number }
  | { readonly code: "given-conflict"; readonly cell: number };

/** Suma mínima y máxima de `count` dígitos distintos entre 1 y `size`. */
export function cageSumRange(count: number, size: number): readonly [number, number] {
  const min = (count * (count + 1)) / 2;
  const max = (count * (2 * size - count + 1)) / 2;
  return [min, max];
}

/** Las celdas forman una región conectada por lados (vacía: no). */
export function isConnected(cells: readonly number[], size: number): boolean {
  const members = new Set(cells);
  const first = cells[0];
  if (first === undefined) return false;
  const seen = new Set([first]);
  const stack = [first];
  for (let cell = stack.pop(); cell !== undefined; cell = stack.pop()) {
    const row = Math.floor(cell / size);
    const col = cell % size;
    const neighbours = [
      row > 0 ? cell - size : -1,
      row < size - 1 ? cell + size : -1,
      col > 0 ? cell - 1 : -1,
      col < size - 1 ? cell + 1 : -1,
    ];
    for (const next of neighbours) {
      if (next >= 0 && members.has(next) && !seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen.size === members.size;
}

/**
 * Comprueba la estructura de un puzzle (SPEC R-20, T-35.3): jaulas de 2 a 5 celdas, conectadas,
 * disjuntas, que cubren el tablero y con sumas alcanzables; números iniciales en rango y sin
 * conflictos con sus pares. Devuelve la lista de problemas; vacía si el puzzle es válido.
 */
export function validateStructure(puzzle: KillerPuzzle): StructureIssue[] {
  if (!isValidGeometry(puzzle)) return [{ code: "geometry" }];
  const { size } = puzzle;
  const cellCount = size * size;
  const issues: StructureIssue[] = [];
  const owner = new Int32Array(cellCount).fill(-1);
  const ids = new Set<number>();

  puzzle.cages.forEach((cage, index) => {
    if (ids.has(cage.id)) issues.push({ code: "cage-id-duplicate", cageId: cage.id });
    ids.add(cage.id);

    const count = cage.cells.length;
    if (count < MIN_CAGE_SIZE || count > Math.min(MAX_CAGE_SIZE, size)) {
      issues.push({ code: "cage-size", cageId: cage.id });
    }
    let inRange = true;
    for (const cell of cage.cells) {
      if (!Number.isInteger(cell) || cell < 0 || cell >= cellCount) {
        issues.push({ code: "cage-cell-out-of-range", cageId: cage.id, cell });
        inRange = false;
      } else if (owner[cell] !== -1) {
        issues.push({ code: "cage-overlap", cageId: cage.id, cell });
      } else {
        owner[cell] = index;
      }
    }
    if (inRange && count > 0 && !isConnected(cage.cells, size)) {
      issues.push({ code: "cage-disconnected", cageId: cage.id });
    }
    const [min, max] = cageSumRange(count, size);
    if (!Number.isInteger(cage.sum) || count > size || cage.sum < min || cage.sum > max) {
      issues.push({ code: "cage-sum-unreachable", cageId: cage.id });
    }
  });

  for (let cell = 0; cell < cellCount; cell++) {
    if (owner[cell] === -1) issues.push({ code: "cell-uncovered", cell });
  }

  const layout = layoutOf(puzzle);
  const givenAt = new Map<number, number>();
  for (const { cell, value } of puzzle.givens) {
    const valid =
      Number.isInteger(cell) &&
      cell >= 0 &&
      cell < cellCount &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= size;
    if (!valid) issues.push({ code: "given-invalid", cell });
    else if (givenAt.has(cell)) issues.push({ code: "given-duplicate-cell", cell });
    else givenAt.set(cell, value);
  }
  for (const [cell, value] of givenAt) {
    const cage = puzzle.cages[at(owner, cell)];
    const peers = new Set([...at(layout.peers, cell), ...(cage?.cells ?? [])]);
    peers.delete(cell);
    if ([...peers].some((peer) => givenAt.get(peer) === value)) {
      issues.push({ code: "given-conflict", cell });
    }
  }
  return issues;
}
