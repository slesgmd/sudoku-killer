// Motor del puzzle (F4): lógica pura, sin E/S, reloj ni azar.

export const DEFAULT_BOARD_SIZE = 9;

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
