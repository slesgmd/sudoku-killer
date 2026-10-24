// Banco completo (F5): carga todo el manifiesto en PGlite, lo que regenera y verifica cada semilla
// (T-20.4), y juega una partida simulada sobre cada puzzle leído de la base de datos (T-20.5):
// `levelToDeduce` nunca devuelve `UNRATED`. No corre en la CI de cada push: `pnpm test:corpus`.
import { DIFFICULTIES } from "@sudoku-killer/protocol";
import { describe, expect, it } from "vitest";
import { puzzles } from "../src/db/schema.ts";
import { loadBank } from "../src/puzzles/load-bank.ts";
import { createPuzzleRepository } from "../src/puzzles/repository.ts";
import { expectGameNeverUnrated, readManifest } from "./helpers/bank.ts";
import { createTestDatabase } from "./helpers/db.ts";

describe("bank corpus", () => {
  it(
    "T-20.4 and T-20.5: the whole manifest loads, and no bank game ever gets UNRATED",
    { timeout: 3_600_000 },
    async () => {
      const manifest = readManifest();
      const { db, client } = await createTestDatabase();
      try {
        const start = performance.now();
        const loaded = await loadBank(db, manifest);
        const loadSeconds = (performance.now() - start) / 1000;
        expect(loaded).toEqual({ inserted: manifest.entries.length, existing: 0 });

        const repository = createPuzzleRepository(db);
        expect(await repository.countByDifficulty()).toEqual(
          Object.fromEntries(DIFFICULTIES.map((d) => [d, manifest.perDifficulty])),
        );

        const rows = await db.select({ id: puzzles.id }).from(puzzles);
        let calls = 0;
        const gameStart = performance.now();
        for (const { id } of rows) {
          const record = await repository.getForServer(id);
          if (!record) throw new Error(`Missing ${id}`);
          calls += expectGameNeverUnrated(
            { puzzle: record, solution: record.solution },
            record.graderMaxLevel,
            record.seed,
          );
        }
        const gameSeconds = (performance.now() - gameStart) / 1000;
        console.log(
          `Bank: ${String(manifest.entries.length)} puzzles loaded and verified in ${loadSeconds.toFixed(1)} s; ${String(calls)} levelToDeduce calls in ${String(rows.length)} simulated games, none UNRATED (${gameSeconds.toFixed(1)} s)`,
        );
      } finally {
        await client.close();
      }
    },
  );
});
