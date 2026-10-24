// Banco de puzzles (F5, ADR 0006): el banco se versiona como un manifiesto de semillas, porque el
// generador es determinista. Cada entrada guarda lo necesario para regenerar el puzzle y comprobar
// que sigue siendo el mismo (versiones y hash), y su calificación.
import { createHash } from "node:crypto";
import {
  GENERATOR_VERSION,
  GRADER_VERSION,
  UNIT_COMBINATION_BOUND,
  addGivens,
  generatePuzzle,
  grade,
  type GeneratedPuzzle,
  type GradeResult,
} from "@sudoku-killer/engine";
import { DIFFICULTIES, difficultySchema, type Difficulty } from "@sudoku-killer/protocol";
import { z } from "zod";
import {
  DIFFICULTY_MAPPING_VERSION,
  DIFFICULTY_RULES,
  difficultyOfSeed,
  givensByDifficulty,
} from "./difficulty.ts";

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
  /** Números iniciales de cada dificultad (equivalencia vigente). */
  givens: z.record(difficultySchema, z.int().nonnegative()),
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

/** Una semilla generada para su dificultad, con sus números iniciales y su calificación. */
export interface BankCandidate {
  readonly seed: number;
  /** La dificultad de la semilla (`difficultyOfSeed`). */
  readonly difficulty: Difficulty;
  /** Si el puzzle final cumple la banda de su dificultad y entra al banco. */
  readonly accepted: boolean;
  /** El puzzle final, o el base si la guarda no dejó llegar a la cantidad de números. */
  readonly generated: GeneratedPuzzle;
  readonly result: GradeResult;
  readonly hash: string;
}

/**
 * Genera el puzzle de la semilla, le agrega los números iniciales de su dificultad (repartidos por
 * cajas, con la guarda del piso de la banda) y lo califica con ellos.
 */
export function evaluateSeed(seed: number): BankCandidate {
  const difficulty = difficultyOfSeed(seed);
  const rule = DIFFICULTY_RULES[difficulty];
  const base = generatePuzzle({ seed });
  const withGivens =
    rule.givens > 0 ? addGivens(base, { count: rule.givens, seed, keep: rule.floor }) : null;
  const generated = withGivens?.generated ?? base;
  const result = withGivens?.result ?? grade(base.puzzle);
  const reached = rule.givens === 0 || withGivens !== null;
  return {
    seed,
    difficulty,
    accepted: reached && rule.accepts(result),
    generated,
    result,
    hash: puzzleHash(generated),
  };
}

/** Lo que se mide al generar el banco, por dificultad (docs/dificultad.md). */
export interface DifficultyStats {
  /** Semillas de la dificultad evaluadas (candidatos). */
  readonly candidates: number;
  /** De ellas, las que entraron al banco. */
  readonly accepted: number;
  /** Milisegundos por candidato (generar, agregar números, calificar y hash). */
  readonly msPerCandidate: number;
}

export interface BankStats {
  /** Última semilla recorrida, desde `baseSeed`. */
  readonly lastSeed: number;
  readonly byDifficulty: Readonly<Record<Difficulty, DifficultyStats>>;
  readonly totalMs: number;
}

export interface BuildBankOptions {
  readonly baseSeed?: number;
  readonly perDifficulty?: number;
  /** Se llama con cada semilla evaluada (para mostrar el avance o medir). */
  readonly onCandidate?: (candidate: BankCandidate) => void;
}

/**
 * Recorre las semillas desde `baseSeed` en orden. Cada semilla es de una sola dificultad; si esa
 * dificultad ya tiene sus `perDifficulty`, la semilla se salta sin evaluarla. Se queda con las
 * primeras que cumplen la banda, hasta completarlas todas. Determinista: las mismas opciones dan el
 * mismo manifiesto.
 */
export function buildBank({
  baseSeed = 1,
  perDifficulty = DEFAULT_PER_DIFFICULTY,
  onCandidate,
}: BuildBankOptions = {}): { manifest: Manifest; stats: BankStats } {
  const zero = (): Record<Difficulty, number> => ({ easy: 0, medium: 0, hard: 0, expert: 0 });
  const accepted = zero();
  const candidates = zero();
  const ms = zero();
  const entries: ManifestEntry[] = [];
  let seed = baseSeed;
  const start = performance.now();

  for (; DIFFICULTIES.some((d) => accepted[d] < perDifficulty); seed++) {
    const difficulty = difficultyOfSeed(seed);
    if (accepted[difficulty] >= perDifficulty) continue;
    const begin = performance.now();
    const candidate = evaluateSeed(seed);
    ms[difficulty] += performance.now() - begin;
    candidates[difficulty]++;
    onCandidate?.(candidate);
    if (!candidate.accepted) continue;
    accepted[difficulty]++;
    entries.push({
      seed,
      difficulty,
      graderMaxLevel: candidate.result.maxLevel,
      graderSteps: candidate.result.steps,
      hash: candidate.hash,
    });
  }

  const stat = (d: Difficulty): DifficultyStats => ({
    candidates: candidates[d],
    accepted: accepted[d],
    msPerCandidate: ms[d] / Math.max(1, candidates[d]),
  });
  return {
    manifest: {
      generatorVersion: GENERATOR_VERSION,
      graderVersion: GRADER_VERSION,
      mappingVersion: DIFFICULTY_MAPPING_VERSION,
      unitCombinationBound: { ...UNIT_COMBINATION_BOUND },
      givens: givensByDifficulty(),
      baseSeed,
      perDifficulty,
      entries,
    },
    stats: {
      lastSeed: seed - 1,
      byDifficulty: {
        easy: stat("easy"),
        medium: stat("medium"),
        hard: stat("hard"),
        expert: stat("expert"),
      },
      totalMs: performance.now() - start,
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

/**
 * Regenera la entrada y comprueba que da el mismo puzzle (hash), la misma calificación y la misma
 * dificultad, y que entra en su banda. Lanza `Error` con la semilla si no.
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
  if (!candidate.accepted || keys.some((key) => actual[key] !== entry[key])) {
    throw new Error(
      `Bank seed ${String(entry.seed)} no longer matches the manifest: ${JSON.stringify({ ...actual, accepted: candidate.accepted })}`,
    );
  }
  return candidate;
}
