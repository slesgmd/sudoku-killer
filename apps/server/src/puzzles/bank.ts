// Banco de puzzles (F5, ADR 0006): el banco se versiona como un manifiesto de semillas, porque el
// generador es determinista. La parte pura (equivalencia, manifiesto y regeneración) está en
// `@sudoku-killer/bank`; aquí quedan el hash, la construcción del banco y la verificación.
import { createHash } from "node:crypto";
import {
  DIFFICULTY_MAPPING_VERSION,
  canonicalPuzzle,
  difficultyOfSeed,
  givensByDifficulty,
  regenerateSeed,
  type Manifest,
  type ManifestEntry,
  type RegeneratedSeed,
} from "@sudoku-killer/bank";
import {
  GENERATOR_VERSION,
  GRADER_VERSION,
  UNIT_COMBINATION_BOUND,
  type GeneratedPuzzle,
} from "@sudoku-killer/engine";
import { DIFFICULTIES, type Difficulty } from "@sudoku-killer/protocol";

/** Puzzles por dificultad del banco de la v1 (criterio de aceptación de F5). */
export const DEFAULT_PER_DIFFICULTY = 500;

export function puzzleHash(generated: GeneratedPuzzle): string {
  return createHash("sha256").update(canonicalPuzzle(generated)).digest("hex").slice(0, 16);
}

/** Una semilla regenerada con el hash de su puzzle. */
export interface BankCandidate extends RegeneratedSeed {
  readonly hash: string;
}

/** Regenera la semilla (`regenerateSeed`) y calcula el hash de su puzzle. */
export function evaluateSeed(seed: number): BankCandidate {
  const regenerated = regenerateSeed(seed);
  return { ...regenerated, hash: puzzleHash(regenerated.generated) };
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
