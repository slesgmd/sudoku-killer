// Motor del puzzle (F4): lógica pura, sin E/S, reloj ni azar.

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
  MAX_CAGE_SIZE,
  MIN_CAGE_SIZE,
  cageSumRange,
  validateStructure,
  type StructureIssue,
} from "./model/structure.ts";
export {
  checkPlacement,
  isEvidentMistake,
  validateSolution,
  type SolutionIssue,
} from "./model/validate.ts";
export {
  cleanupPeers,
  clearCellNotes,
  type CleanupResult,
  type NoteRemoval,
} from "./model/notes.ts";
export { solveA, type SolveAOptions, type SolveAResult } from "./solver-a/solve.ts";
export { solveB, type SolveBOptions, type SolveBResult } from "./solver-b/solve.ts";
