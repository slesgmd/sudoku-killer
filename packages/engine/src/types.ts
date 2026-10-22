// Tipos de datos del motor. Son lo único que comparten los solvers A y B (SPEC R-35), así que
// este archivo solo declara tipos: nada de lógica.

/** Tablero de `size` × `size` con cajas de `boxRows` × `boxCols` (SPEC §2.1). */
export interface Geometry {
  readonly size: number;
  readonly boxRows: number;
  readonly boxCols: number;
}

/** Jaula de 2 a 5 celdas con su suma (SPEC §2.2, P2). */
export interface Cage {
  readonly id: number;
  readonly cells: readonly number[];
  readonly sum: number;
}

/** Número inicial: celda y dígito. */
export interface Given {
  readonly cell: number;
  readonly value: number;
}

/** Puzzle sin la solución: lo mismo que `PublicPuzzle` sin metadatos. */
export interface KillerPuzzle extends Geometry {
  readonly cages: readonly Cage[];
  readonly givens: readonly Given[];
}

/** Cuadrícula completa: `size²` dígitos de 1 a `size`, por filas. */
export type Grid = readonly number[];
