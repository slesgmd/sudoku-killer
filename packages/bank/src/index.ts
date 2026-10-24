// Banco de puzzles, parte pura (F5 y F8): equivalencia de dificultades, manifiesto y regeneración de
// semillas. Sin E/S: el hash y la carga en la base de datos quedan en `apps/server`.
export {
  DIFFICULTY_MAPPING_VERSION,
  DIFFICULTY_RULES,
  difficultyOfSeed,
  givensByDifficulty,
  type DifficultyRule,
} from "./difficulty.ts";
export {
  assertCurrentManifest,
  manifestEntrySchema,
  manifestSchema,
  type Manifest,
  type ManifestEntry,
} from "./manifest.ts";
export { canonicalPuzzle, regenerateSeed, type RegeneratedSeed } from "./regenerate.ts";
export { pickPuzzle } from "./pick.ts";
