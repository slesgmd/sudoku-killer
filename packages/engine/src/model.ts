// Punto de entrada del modelo del tablero (`@sudoku-killer/engine/model`): geometría, máscaras y
// limpieza de notas. Es lo único del motor que puede usar el cliente de producción (T-31.2): no
// arrastra los solvers, el generador ni el calificador.
export type { Cage, Geometry, Given, Grid, KillerPuzzle } from "./types.ts";
export {
  DEFAULT_BOARD_SIZE,
  MAX_BOARD_SIZE,
  STANDARD_GEOMETRY,
  cageIndexByCell,
  cellIndex,
  isValidGeometry,
  layoutOf,
  peersWithCage,
  type Layout,
} from "./model/geometry.ts";
export { digitBit, digitsOf, fullMask, hasDigit, popcount, singleDigit } from "./model/mask.ts";
export {
  cleanupPeers,
  clearCellNotes,
  type CleanupResult,
  type NoteRemoval,
} from "./model/notes.ts";
