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
export { createRng, isValidSeed, type Rng } from "./generator/rng.ts";
export type { CageSizeWeights } from "./generator/cages.ts";
export {
  DEFAULT_CAGE_SIZE_WEIGHTS,
  DEFAULT_MAX_ADJUSTMENTS,
  DEFAULT_MAX_CANDIDATES,
  DEFAULT_MAX_NODES,
  GENERATOR_VERSION,
  generatePuzzle,
  type GenerateOptions,
  type GeneratedPuzzle,
  type GenerationStats,
  type GivensReason,
} from "./generator/generate.ts";
export { addGivens, type AddGivensOptions, type PuzzleWithGivens } from "./generator/givens.ts";
export {
  MAX_TECHNIQUE_LEVEL,
  UNRATED,
  type Deduction,
  type Technique,
  type TechniqueId,
} from "./grader/types.ts";
export {
  GRADER_VERSION,
  TECHNIQUES,
  UNIT_COMBINATION_BOUND,
  grade,
  levelToDeduce,
  levelsToDeduce,
  type BoardLevels,
  type BoardState,
  type Exclusion,
  type GradeOptions,
  type GradeResult,
  type GradeStatus,
  type GradeStep,
} from "./grader/grade.ts";
export {
  UNBOUNDED,
  unitCombinationWithin,
  type UnitCombinationBound,
} from "./grader/unit-combination.ts";
