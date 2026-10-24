// Esquema `puzzles`, carga del banco y repositorio con PGlite (ADR 0003 y ADR 0006). T-20.4: el
// banco cargado coincide con el manifiesto, la carga es idempotente, el `id` es opaco y ni la
// solución ni la semilla salen en el puzzle público. T-20.2 en las filas cargadas. T-20.3: la base
// de datos rechaza niveles fuera de 1 a 5 y dificultades desconocidas.
import type { PGlite } from "@electric-sql/pglite";
import { DIFFICULTIES, publicPuzzleSchema } from "@sudoku-killer/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/db/database.ts";
import { puzzles } from "../src/db/schema.ts";
import type { Manifest } from "@sudoku-killer/bank";
import { evaluateSeed } from "../src/puzzles/bank.ts";
import { loadBank } from "../src/puzzles/load-bank.ts";
import { createPuzzleRepository } from "../src/puzzles/repository.ts";
import { decodeSolution, encodeSolution } from "../src/puzzles/solution.ts";
import { readManifest, sampleOf } from "./helpers/bank.ts";
import { createTestDatabase } from "./helpers/db.ts";

const PER_DIFFICULTY = 10;
const SLOW = { timeout: 120_000 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MISSING = "00000000-0000-4000-8000-000000000000";

let db: Database;
let client: PGlite;
const sample: Manifest = sampleOf(readManifest(), PER_DIFFICULTY);

beforeAll(async () => {
  ({ db, client } = await createTestDatabase());
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe("T-20.4 loading the bank", () => {
  it("inserts every sampled entry once, and a second load inserts nothing", SLOW, async () => {
    const total = sample.entries.length;
    expect(await loadBank(db, sample)).toEqual({ inserted: total, existing: 0 });
    expect(await loadBank(db, sample)).toEqual({ inserted: 0, existing: total });
    const counts = await createPuzzleRepository(db).countByDifficulty();
    expect(counts).toEqual(Object.fromEntries(DIFFICULTIES.map((d) => [d, PER_DIFFICULTY])));
  });

  it("rejects a changed entry before writing anything", SLOW, async () => {
    const [entry, ...rest] = sample.entries;
    if (!entry) throw new Error("Empty sample");
    const before = await db.$count(puzzles);
    const broken = { ...sample, entries: [...rest, { ...entry, seed: entry.seed + 100_000 }] };
    await expect(loadBank(db, broken)).rejects.toThrow(/no longer matches/);
    expect(await db.$count(puzzles)).toBe(before);
  });

  it("rows match the regenerated puzzles; ids are random UUIDs; T-20.2 holds", SLOW, async () => {
    const repository = createPuzzleRepository(db);
    const rows = await db.select({ id: puzzles.id, seed: puzzles.seed }).from(puzzles);
    expect(rows).toHaveLength(sample.entries.length);
    for (const { id, seed } of rows) {
      expect(id).toMatch(UUID);
      const record = await repository.getForServer(id);
      const entry = sample.entries.find((e) => e.seed === seed);
      if (!record || !entry) throw new Error(`Missing ${id}`);
      const { puzzle, solution, givensReason } = evaluateSeed(seed).generated;
      expect(record).toEqual({
        id,
        size: puzzle.size,
        boxRows: puzzle.boxRows,
        boxCols: puzzle.boxCols,
        difficulty: entry.difficulty,
        cages: puzzle.cages,
        givens: puzzle.givens,
        solution,
        graderMaxLevel: entry.graderMaxLevel,
        graderSteps: entry.graderSteps,
        graderVersion: sample.graderVersion,
        generatorVersion: sample.generatorVersion,
        seed,
        givensReason,
      });
      // T-20.2: números iniciales solo con `difficulty` o `uniqueness`, y siempre de la solución.
      if (record.givensReason === "none") expect(record.givens).toEqual([]);
      for (const { cell, value } of record.givens) expect(record.solution[cell]).toBe(value);
    }
  });

  it("the public puzzle carries neither the solution nor the seed", async () => {
    const repository = createPuzzleRepository(db);
    const [row] = await db.select({ id: puzzles.id }).from(puzzles).limit(1);
    if (!row) throw new Error("Empty table");
    const found = await repository.getPublic(row.id);
    expect(Object.keys(found ?? {}).sort()).toEqual(
      ["boxCols", "boxRows", "cages", "difficulty", "givens", "id", "size"].sort(),
    );
    expect(publicPuzzleSchema.strict().parse(found)).toEqual(found);
    expect(await repository.getPublic(MISSING)).toBeNull();
    expect(await repository.getForServer(MISSING)).toBeNull();
  });
});

describe("T-20.3 database constraints", () => {
  const insert = (difficulty: string, level: number, seed: number) =>
    client.query(
      `INSERT INTO puzzles (size, box_rows, box_cols, difficulty, cages, givens, solution,
        grader_max_level, grader_steps, grader_version, givens_reason, generator_version, seed)
       VALUES (4, 2, 2, $1, '[]', '[]', '1234341221434321', $2, 1, '2', 'none', 'test', $3)`,
      [difficulty, level, seed],
    );

  it("rejects levels outside 1 to 5 and unknown difficulties", async () => {
    await expect(insert("easy", 6, 1)).rejects.toThrow(/grader_max_level/);
    await expect(insert("easy", 0, 2)).rejects.toThrow(/grader_max_level/);
    await expect(insert("insane", 3, 3)).rejects.toThrow(/difficulty/);
    await expect(insert("easy", 2, 4)).resolves.toBeDefined();
  });
});

describe("solution encoding", () => {
  it("round-trips digits 1 to 35 and rejects the rest", () => {
    const digits = Array.from({ length: 35 }, (_, i) => i + 1);
    expect(decodeSolution(encodeSolution(digits))).toEqual(digits);
    expect(() => encodeSolution([0])).toThrow(RangeError);
    expect(() => encodeSolution([36])).toThrow(RangeError);
    expect(() => decodeSolution("1-")).toThrow(RangeError);
  });
});
