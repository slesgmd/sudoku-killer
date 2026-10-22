import type { Cage, Geometry } from "../types.ts";
import { at } from "./at.ts";

export const DEFAULT_BOARD_SIZE = 9;
export const MAX_BOARD_SIZE = 16;
export const STANDARD_GEOMETRY: Geometry = { size: 9, boxRows: 3, boxCols: 3 };

/** Unidades y pares de una geometría, precalculados. */
export interface Layout {
  readonly geometry: Geometry;
  readonly cellCount: number;
  readonly rows: readonly (readonly number[])[];
  readonly cols: readonly (readonly number[])[];
  readonly boxes: readonly (readonly number[])[];
  /** Fila, columna y caja de cada celda. */
  readonly rowOf: Uint8Array;
  readonly colOf: Uint8Array;
  readonly boxOf: Uint8Array;
  /** Pares por fila, columna y caja (sin la jaula), sin repetir y sin la propia celda. */
  readonly peers: readonly (readonly number[])[];
}

export function isValidGeometry(geometry: Geometry): boolean {
  const { size, boxRows, boxCols } = geometry;
  return (
    Number.isInteger(size) &&
    Number.isInteger(boxRows) &&
    Number.isInteger(boxCols) &&
    size >= 1 &&
    size <= MAX_BOARD_SIZE &&
    boxRows >= 1 &&
    boxCols >= 1 &&
    boxRows * boxCols === size
  );
}

/** Índice lineal de la celda (fila, columna) en un tablero de `size` × `size`. */
export function cellIndex(row: number, col: number, size: number = DEFAULT_BOARD_SIZE): number {
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) {
    throw new RangeError(`Invalid cell (${String(row)}, ${String(col)})`);
  }
  if (row >= size || col >= size) {
    throw new RangeError(
      `Cell (${String(row)}, ${String(col)}) is outside a ${String(size)}x${String(size)} board`,
    );
  }
  return row * size + col;
}

const layouts = new Map<string, Layout>();

/** Devuelve las unidades y los pares de la geometría (memoizado). */
export function layoutOf(geometry: Geometry): Layout {
  const key = `${String(geometry.size)}:${String(geometry.boxRows)}:${String(geometry.boxCols)}`;
  const cached = layouts.get(key);
  if (cached) return cached;
  if (!isValidGeometry(geometry)) throw new RangeError(`Invalid geometry ${key}`);

  const { size, boxRows, boxCols } = geometry;
  const cellCount = size * size;
  const rowOf = new Uint8Array(cellCount);
  const colOf = new Uint8Array(cellCount);
  const boxOf = new Uint8Array(cellCount);
  const rows: number[][] = Array.from({ length: size }, () => []);
  const cols: number[][] = Array.from({ length: size }, () => []);
  const boxes: number[][] = Array.from({ length: size }, () => []);
  const boxesPerBand = size / boxCols;

  for (let cell = 0; cell < cellCount; cell++) {
    const row = Math.floor(cell / size);
    const col = cell % size;
    const box = Math.floor(row / boxRows) * boxesPerBand + Math.floor(col / boxCols);
    rowOf[cell] = row;
    colOf[cell] = col;
    boxOf[cell] = box;
    at(rows, row).push(cell);
    at(cols, col).push(cell);
    at(boxes, box).push(cell);
  }

  const peers = Array.from({ length: cellCount }, (_, cell) => {
    const set = new Set([
      ...at(rows, at(rowOf, cell)),
      ...at(cols, at(colOf, cell)),
      ...at(boxes, at(boxOf, cell)),
    ]);
    set.delete(cell);
    return [...set].sort((a, b) => a - b);
  });

  const layout: Layout = { geometry, cellCount, rows, cols, boxes, rowOf, colOf, boxOf, peers };
  layouts.set(key, layout);
  return layout;
}

/** Índice de jaula de cada celda (−1 si ninguna jaula la cubre). Si hay solapes, gana la última. */
export function cageIndexByCell(cellCount: number, cages: readonly Cage[]): Int16Array {
  const index = new Int16Array(cellCount).fill(-1);
  cages.forEach((cage, i) => {
    for (const cell of cage.cells) {
      if (cell >= 0 && cell < cellCount) index[cell] = i;
    }
  });
  return index;
}

/** Pares de una celda incluyendo su jaula (SPEC §2.1): fila, columna, caja y jaula. */
export function peersWithCage(layout: Layout, cage: Cage | undefined, cell: number): number[] {
  const set = new Set(layout.peers[cell]);
  for (const other of cage?.cells ?? []) {
    if (other !== cell) set.add(other);
  }
  return [...set].sort((a, b) => a - b);
}
