// De dónde saca el puzzle el servidor simulado: una semilla del manifiesto del banco
// (`apps/server/bank/manifest.json`, ADR 0006) de la dificultad pedida, regenerada en el navegador con
// `regenerateSeed` y comprobada contra su entrada (dificultad, calificación y hash). El manifiesto
// se importa con el alias `@dev/bank-manifest`, que solo existe en desarrollo y en las pruebas.
import {
  canonicalPuzzle,
  manifestSchema,
  regenerateSeed,
  type Manifest,
  type ManifestEntry,
} from "@sudoku-killer/bank";
import type { Difficulty, PublicPuzzle } from "@sudoku-killer/protocol";
import { puzzleHashSubtle } from "./hash.ts";
import type { SimPuzzle } from "./server.ts";

let manifest: Manifest | null = null;

export async function loadManifest(): Promise<Manifest> {
  if (!manifest) {
    const module = await import("@dev/bank-manifest");
    manifest = manifestSchema.parse(module.default);
  }
  return manifest;
}

export interface LoadedPuzzle extends SimPuzzle {
  readonly entry: ManifestEntry;
  /** Lo que tardó la regeneración y la comprobación, en milisegundos. */
  readonly ms: number;
}

/** Regenera la entrada y comprueba que es la del manifiesto. Lanza `Error` si no. */
export async function regenerateEntry(entry: ManifestEntry, id: string): Promise<LoadedPuzzle> {
  const begin = performance.now();
  const { difficulty, accepted, generated, result } = regenerateSeed(entry.seed);
  const hash = await puzzleHashSubtle(canonicalPuzzle(generated));
  const ms = performance.now() - begin;
  const actual = { difficulty, accepted, maxLevel: result.maxLevel, steps: result.steps, hash };
  const expected = {
    difficulty: entry.difficulty,
    accepted: true,
    maxLevel: entry.graderMaxLevel,
    steps: entry.graderSteps,
    hash: entry.hash,
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Seed ${String(entry.seed)} does not match the manifest: ${JSON.stringify(actual)}`,
    );
  }
  const { puzzle, solution } = generated;
  const publicPuzzle: PublicPuzzle = {
    id,
    size: puzzle.size,
    boxRows: puzzle.boxRows,
    boxCols: puzzle.boxCols,
    difficulty,
    cages: puzzle.cages.map(({ id: cageId, cells, sum }) => ({
      id: cageId,
      cells: [...cells],
      sum,
    })),
    givens: puzzle.givens.map(({ cell, value }) => ({ cell, value })),
  };
  return { puzzle: publicPuzzle, solution, entry, ms };
}

/** Una semilla al azar de la dificultad, regenerada y comprobada. */
export async function loadPuzzle(
  difficulty: Difficulty,
  randomInt: (bound: number) => number,
  id: string,
): Promise<LoadedPuzzle> {
  const entries = (await loadManifest()).entries.filter((e) => e.difficulty === difficulty);
  const entry = entries[randomInt(entries.length)];
  if (!entry) throw new Error(`No puzzles for ${difficulty}`);
  return regenerateEntry(entry, id);
}
