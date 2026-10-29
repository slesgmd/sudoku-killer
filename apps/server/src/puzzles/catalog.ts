// Catálogo de puzzles del servidor: los `id` de cada dificultad se leen al arrancar (el banco no
// cambia en ejecución) y cada partida elige con `pickPuzzle`, sin repetir los de la sala (R-21).
// Si alguna dificultad no tiene puzzles, el servidor no arranca.
import { pickPuzzle } from "@sudoku-killer/bank";
import type { Rng } from "@sudoku-killer/engine";
import { DIFFICULTIES, type Difficulty, type PublicPuzzle } from "@sudoku-killer/protocol";
import { Lru } from "../rooms/lru.ts";
import type { PuzzleRepository } from "./repository.ts";
import type { PuzzleRecord } from "./types.ts";

export interface ServerPuzzle {
  readonly puzzle: PublicPuzzle;
  /** Solo para decidir las jugadas: nunca sale del servidor (R-31). */
  readonly solution: readonly number[];
}

export interface PuzzleCatalog {
  /** Elige un puzzle de la dificultad que la sala no jugó (o el que jugó hace más tiempo). */
  pick(difficulty: Difficulty, played: readonly string[], rng: Rng): Promise<ServerPuzzle>;
  /** Un puzzle por su `id` (reconstrucción tras un reinicio). */
  get(id: string): Promise<ServerPuzzle>;
}

export class EmptyBankError extends Error {
  constructor(missing: readonly Difficulty[]) {
    super(
      `The puzzle bank has no puzzles for: ${missing.join(", ")}. Run \`pnpm --filter @sudoku-killer/server bank:load\`.`,
    );
    this.name = "EmptyBankError";
  }
}

/** Lo que puede salir del servidor: sin la solución, la semilla ni la calificación. */
export function publicPuzzleOf(record: PuzzleRecord): PublicPuzzle {
  return {
    id: record.id,
    size: record.size,
    boxRows: record.boxRows,
    boxCols: record.boxCols,
    difficulty: record.difficulty,
    cages: record.cages.map(({ id, cells, sum }) => ({ id, cells: [...cells], sum })),
    givens: record.givens.map(({ cell, value }) => ({ cell, value })),
  };
}

/**
 * Puzzles que la caché conserva (`docs/carga.md` §6). Sin tope, cada puzzle jugado quedaba en
 * memoria para siempre, y con él el contexto del calificador del motor (unos 80 KB por puzzle, en un
 * `WeakMap`): hasta unos 160 MB con el banco completo. Las partidas en curso conservan su puzzle
 * aunque salga de aquí, así que basta con cubrir las que empiezan a la vez.
 */
export const CATALOG_CACHE_ENTRIES = 64;

export async function createPuzzleCatalog(
  repository: PuzzleRepository,
  { cacheEntries = CATALOG_CACHE_ENTRIES }: { readonly cacheEntries?: number } = {},
): Promise<PuzzleCatalog> {
  const ids = new Map<Difficulty, string[]>();
  for (const difficulty of DIFFICULTIES) ids.set(difficulty, await repository.listIds(difficulty));
  const missing = DIFFICULTIES.filter((d) => (ids.get(d)?.length ?? 0) === 0);
  if (missing.length > 0) throw new EmptyBankError(missing);

  const cache = new Lru<string, ServerPuzzle>(cacheEntries);
  const get = async (id: string): Promise<ServerPuzzle> => {
    const cached = cache.get(id);
    if (cached) return cached;
    const record = await repository.getForServer(id);
    if (!record) throw new Error(`Unknown puzzle ${id}`);
    const loaded = { puzzle: publicPuzzleOf(record), solution: record.solution };
    cache.set(id, loaded);
    return loaded;
  };
  return {
    get,
    async pick(difficulty, played, rng) {
      const id = pickPuzzle(ids.get(difficulty) ?? [], played, rng);
      if (id === null) throw new EmptyBankError([difficulty]);
      return get(id);
    },
  };
}
