// Manifiesto del banco (ADR 0006): las semillas del banco con lo necesario para regenerar cada
// puzzle y comprobar que sigue siendo el mismo (versiones y hash), y su calificación.
import { GENERATOR_VERSION, GRADER_VERSION, UNIT_COMBINATION_BOUND } from "@sudoku-killer/engine";
import { DIFFICULTIES, difficultySchema } from "@sudoku-killer/protocol";
import { z } from "zod";
import { DIFFICULTY_MAPPING_VERSION, givensByDifficulty } from "./difficulty.ts";

export const manifestEntrySchema = z.object({
  seed: z.int().nonnegative(),
  difficulty: difficultySchema,
  graderMaxLevel: z.int().min(1).max(5),
  graderSteps: z.int().positive(),
  /** Primeros 16 dígitos hexadecimales del SHA-256 de `canonicalPuzzle`. */
  hash: z.string().regex(/^[0-9a-f]{16}$/),
});

export const manifestSchema = z.object({
  generatorVersion: z.string(),
  graderVersion: z.string(),
  mappingVersion: z.string(),
  unitCombinationBound: z.object({ maxOpenCages: z.int(), maxCombinations: z.int() }),
  /** Números iniciales de cada dificultad (equivalencia vigente). */
  givens: z.record(difficultySchema, z.int().nonnegative()),
  baseSeed: z.int().nonnegative(),
  perDifficulty: z.int().positive(),
  /** En orden de semilla. */
  entries: z.array(manifestEntrySchema),
});

export type ManifestEntry = z.infer<typeof manifestEntrySchema>;
export type Manifest = z.infer<typeof manifestSchema>;

/**
 * Comprueba que el manifiesto corresponde al motor y a la equivalencia actuales: mismas versiones
 * del generador, del calificador y de la equivalencia, la misma cota y los mismos números iniciales.
 * Lanza `Error` si no.
 */
export function assertCurrentManifest(manifest: Manifest): void {
  const givens = givensByDifficulty();
  const expected = {
    generatorVersion: GENERATOR_VERSION,
    graderVersion: GRADER_VERSION,
    mappingVersion: DIFFICULTY_MAPPING_VERSION,
    unitCombinationBound: { ...UNIT_COMBINATION_BOUND },
    givens: DIFFICULTIES.map((d) => givens[d]),
  };
  const actual = {
    generatorVersion: manifest.generatorVersion,
    graderVersion: manifest.graderVersion,
    mappingVersion: manifest.mappingVersion,
    unitCombinationBound: {
      maxOpenCages: manifest.unitCombinationBound.maxOpenCages,
      maxCombinations: manifest.unitCombinationBound.maxCombinations,
    },
    givens: DIFFICULTIES.map((d) => manifest.givens[d]),
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `The bank manifest is for ${JSON.stringify(actual)}, but the engine is ${JSON.stringify(expected)}: generate a new manifest`,
    );
  }
}
