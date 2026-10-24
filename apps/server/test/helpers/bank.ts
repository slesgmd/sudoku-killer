// Ayudas de las pruebas del banco: el manifiesto versionado, muestras por dificultad y partidas
// simuladas para T-20.5.
import { readFileSync } from "node:fs";
import { UNRATED, createRng, levelToDeduce, type KillerPuzzle } from "@sudoku-killer/engine";
import { DIFFICULTIES } from "@sudoku-killer/protocol";
import { expect } from "vitest";
import { manifestSchema, type Manifest } from "../../src/puzzles/bank.ts";

export function readManifest(): Manifest {
  const file = new URL("../../bank/manifest.json", import.meta.url);
  return manifestSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

/** El manifiesto con solo las primeras `perDifficulty` entradas de cada dificultad. */
export function sampleOf(manifest: Manifest, perDifficulty: number): Manifest {
  const entries = DIFFICULTIES.flatMap((difficulty) =>
    manifest.entries.filter((entry) => entry.difficulty === difficulty).slice(0, perDifficulty),
  ).sort((a, b) => a.seed - b.seed);
  return { ...manifest, entries };
}

/**
 * T-20.5: partida simulada sobre un puzzle del banco. Las celdas vacías se llenan con la solución en
 * un orden aleatorio (con la semilla) y, antes de cada jugada, `levelToDeduce` está entre 1 y el
 * nivel máximo del puzzle: nunca `UNRATED`. Devuelve las llamadas hechas.
 */
export function expectGameNeverUnrated(
  { puzzle, solution }: { readonly puzzle: KillerPuzzle; readonly solution: readonly number[] },
  graderMaxLevel: number,
  seed: number,
): number {
  const values = new Array<number>(solution.length).fill(0);
  for (const { cell, value } of puzzle.givens) values[cell] = value;
  const order = values.flatMap((value, cell) => (value === 0 ? [cell] : []));
  const rng = createRng(seed);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j] ?? 0, order[i] ?? 0];
  }
  for (const cell of order) {
    const level = levelToDeduce(cell, { puzzle, values });
    expect(level, `seed ${String(seed)}, cell ${String(cell)}`).not.toBe(UNRATED);
    expect(level, `seed ${String(seed)}, cell ${String(cell)}`).toBeGreaterThanOrEqual(1);
    expect(level, `seed ${String(seed)}, cell ${String(cell)}`).toBeLessThanOrEqual(graderMaxLevel);
    values[cell] = solution[cell] ?? 0;
  }
  return order.length;
}
