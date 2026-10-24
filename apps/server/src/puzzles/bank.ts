// Banco de puzzles (F5, ADR 0006): el banco se versiona como un manifiesto de semillas, porque el
// generador es determinista. Cada entrada guarda lo necesario para regenerar el puzzle y comprobar
// que sigue siendo el mismo (versiones y hash), y su calificación.
import { createHash } from "node:crypto";
import {
  GENERATOR_VERSION,
  GRADER_VERSION,
  UNIT_COMBINATION_BOUND,
  generatePuzzle,
  grade,
  type GeneratedPuzzle,
  type GradeResult,
} from "@sudoku-killer/engine";
import { DIFFICULTIES, difficultySchema, type Difficulty } from "@sudoku-killer/protocol";
import { z } from "zod";
import { DIFFICULTY_MAPPING_VERSION, difficultyOf } from "./difficulty.ts";

/** Puzzles por dificultad del banco de la v1 (criterio de aceptación de F5). */
export const DEFAULT_PER_DIFFICULTY = 500;

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
  baseSeed: z.int().nonnegative(),
  perDifficulty: z.int().positive(),
  /** En orden de semilla. */
  entries: z.array(manifestEntrySchema),
});

export type ManifestEntry = z.infer<typeof manifestEntrySchema>;
export type Manifest = z.infer<typeof manifestSchema>;

/** El puzzle y su solución en un orden de campos fijo, para el hash. */
export function canonicalPuzzle({ puzzle, solution }: GeneratedPuzzle): string {
  return JSON.stringify({
    size: puzzle.size,
    boxRows: puzzle.boxRows,
    boxCols: puzzle.boxCols,
    cages: puzzle.cages.map(({ id, cells, sum }) => ({ id, cells, sum })),
    givens: puzzle.givens.map(({ cell, value }) => ({ cell, value })),
    solution,
  });
}

export function puzzleHash(generated: GeneratedPuzzle): string {
  return createHash("sha256").update(canonicalPuzzle(generated)).digest("hex").slice(0, 16);
}

/** Una semilla generada, calificada y clasificada. */
export interface BankCandidate {
  readonly seed: number;
  readonly generated: GeneratedPuzzle;
  readonly result: GradeResult;
  /** `null` si se excluye (excede las técnicas). */
  readonly difficulty: Difficulty | null;
  readonly hash: string;
}

export function evaluateSeed(seed: number): BankCandidate {
  const generated = generatePuzzle({ seed });
  const result = grade(generated.puzzle);
  return { seed, generated, result, difficulty: difficultyOf(result), hash: puzzleHash(generated) };
}

/** Lo que se mide al generar el banco (docs/dificultad.md). */
export interface BankStats {
  /** Semillas evaluadas (candidatos). */
  readonly seeds: number;
  /** Semillas excluidas porque exceden las técnicas. */
  readonly excluded: number;
  /** Por dificultad: semillas evaluadas hasta completarla y cuántas calificaban en total. */
  readonly filledAfter: Readonly<Record<Difficulty, number>>;
  readonly qualifying: Readonly<Record<Difficulty, number>>;
  /** Candidatos internos de `generatePuzzle` (incluye los descartados por presupuesto). */
  readonly generatorCandidates: number;
  /** Milisegundos por semilla (generar, calificar y hash) y en total. */
  readonly msPerSeed: number;
  readonly totalMs: number;
}

export interface BuildBankOptions {
  readonly baseSeed?: number;
  readonly perDifficulty?: number;
  /** Se llama con cada semilla evaluada (para mostrar el avance o medir). */
  readonly onCandidate?: (candidate: BankCandidate) => void;
}

/**
 * Recorre las semillas desde `baseSeed` en orden y se queda con las primeras `perDifficulty` de
 * cada dificultad, hasta completarlas todas. Las que exceden las técnicas se cuentan y se
 * descartan. Determinista: las mismas opciones dan el mismo manifiesto. Lanza si un fácil usa
 * técnicas de nivel 4 o más (no puede pasar con `difficultyOf`; es la garantía de F5).
 */
export function buildBank({
  baseSeed = 1,
  perDifficulty = DEFAULT_PER_DIFFICULTY,
  onCandidate,
}: BuildBankOptions = {}): { manifest: Manifest; stats: BankStats } {
  const counts = Object.fromEntries(DIFFICULTIES.map((d) => [d, 0])) as Record<Difficulty, number>;
  const filledAfter = { ...counts };
  const qualifying = { ...counts };
  const entries: ManifestEntry[] = [];
  let excluded = 0;
  let generatorCandidates = 0;
  let seed = baseSeed;
  const start = performance.now();

  while (DIFFICULTIES.some((d) => counts[d] < perDifficulty)) {
    const candidate = evaluateSeed(seed);
    onCandidate?.(candidate);
    generatorCandidates += candidate.generated.stats.candidates;
    const { difficulty, result } = candidate;
    if (difficulty === null) {
      excluded++;
    } else {
      qualifying[difficulty]++;
      if (difficulty === "easy" && result.stepsByLevel.slice(4).some((steps) => steps > 0)) {
        throw new Error(`Seed ${String(seed)}: an easy puzzle uses level 4 or more`);
      }
      if (counts[difficulty] < perDifficulty) {
        counts[difficulty]++;
        if (counts[difficulty] === perDifficulty) filledAfter[difficulty] = seed - baseSeed + 1;
        entries.push({
          seed,
          difficulty,
          graderMaxLevel: result.maxLevel,
          graderSteps: result.steps,
          hash: candidate.hash,
        });
      }
    }
    seed++;
  }

  const totalMs = performance.now() - start;
  const seeds = seed - baseSeed;
  return {
    manifest: {
      generatorVersion: GENERATOR_VERSION,
      graderVersion: GRADER_VERSION,
      mappingVersion: DIFFICULTY_MAPPING_VERSION,
      unitCombinationBound: { ...UNIT_COMBINATION_BOUND },
      baseSeed,
      perDifficulty,
      entries,
    },
    stats: {
      seeds,
      excluded,
      filledAfter,
      qualifying,
      generatorCandidates,
      msPerSeed: totalMs / seeds,
      totalMs,
    },
  };
}

/** El manifiesto como JSON, una entrada por línea para que los cambios se lean en un diff. */
export function serializeManifest({ entries, ...header }: Manifest): string {
  const head = JSON.stringify(header, null, 2).replace(/\n}$/, "");
  const lines = entries.map((entry) => `    ${JSON.stringify(entry)}`);
  return `${head},\n  "entries": [\n${lines.join(",\n")}\n  ]\n}\n`;
}

/**
 * Comprueba que el manifiesto corresponde al motor actual: mismas versiones del generador, del
 * calificador y de la equivalencia, y la misma cota. Lanza `Error` si no.
 */
export function assertCurrentManifest(manifest: Manifest): void {
  const expected = {
    generatorVersion: GENERATOR_VERSION,
    graderVersion: GRADER_VERSION,
    mappingVersion: DIFFICULTY_MAPPING_VERSION,
    unitCombinationBound: { ...UNIT_COMBINATION_BOUND },
  };
  const actual = {
    generatorVersion: manifest.generatorVersion,
    graderVersion: manifest.graderVersion,
    mappingVersion: manifest.mappingVersion,
    unitCombinationBound: manifest.unitCombinationBound,
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `The bank manifest is for ${JSON.stringify(actual)}, but the engine is ${JSON.stringify(expected)}: generate a new manifest`,
    );
  }
}

/**
 * Regenera la entrada y comprueba que da el mismo puzzle (hash), la misma calificación y la misma
 * dificultad. Lanza `Error` con la semilla si no.
 */
export function verifyEntry(entry: ManifestEntry): BankCandidate {
  const candidate = evaluateSeed(entry.seed);
  const actual: Record<keyof ManifestEntry, unknown> = {
    seed: candidate.seed,
    difficulty: candidate.difficulty,
    graderMaxLevel: candidate.result.maxLevel,
    graderSteps: candidate.result.steps,
    hash: candidate.hash,
  };
  const keys = Object.keys(actual) as (keyof ManifestEntry)[];
  if (keys.some((key) => actual[key] !== entry[key])) {
    throw new Error(
      `Bank seed ${String(entry.seed)} no longer matches the manifest: ${JSON.stringify(actual)}`,
    );
  }
  return candidate;
}
