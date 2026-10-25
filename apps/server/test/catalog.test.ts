// Caché del catálogo de puzzles (F11f, `docs/carga.md` §6): está acotada. Antes guardaba cada puzzle
// jugado para siempre, y con él el contexto del calificador (un `WeakMap` por puzzle en el motor):
// la memoria crecía con los puzzles distintos jugados hasta cubrir el banco. Las partidas en curso
// conservan su puzzle; lo que sale de la caché se vuelve a leer de la base si hace falta (R-21, E-15).
import { DIFFICULTIES } from "@sudoku-killer/protocol";
import { beforeAll, describe, expect, it } from "vitest";
import { createPuzzleCatalog } from "../src/puzzles/catalog.ts";
import { createPuzzleRepository, type PuzzleRepository } from "../src/puzzles/repository.ts";
import { testBank } from "./helpers/server.ts";

beforeAll(async () => {
  await testBank();
}, 60_000);

/** El repositorio real, contando las lecturas de puzzles. */
async function counted(): Promise<{ repository: PuzzleRepository; reads: string[] }> {
  const { db } = await testBank();
  const inner = createPuzzleRepository(db);
  const reads: string[] = [];
  return {
    reads,
    repository: {
      ...inner,
      getForServer: (id) => {
        reads.push(id);
        return inner.getForServer(id);
      },
    },
  };
}

describe("F11f puzzle catalog cache", () => {
  it("keeps at most `cacheEntries` puzzles: the least recently used one is read again", async () => {
    const { repository, reads } = await counted();
    const ids: string[] = [];
    for (const difficulty of DIFFICULTIES) ids.push(...(await repository.listIds(difficulty)));
    const [a, b, c] = ids;
    if (a === undefined || b === undefined || c === undefined) throw new Error("Small bank");
    const catalog = await createPuzzleCatalog(repository, { cacheEntries: 2 });

    const first = await catalog.get(a);
    await catalog.get(b);
    expect(await catalog.get(a)).toBe(first);
    expect(reads).toEqual([a, b]);
    // `c` desplaza a `b`, el menos usado; `a` sigue en la caché.
    await catalog.get(c);
    await catalog.get(a);
    expect(reads).toEqual([a, b, c]);
    await catalog.get(b);
    expect(reads).toEqual([a, b, c, b]);
  });
});
