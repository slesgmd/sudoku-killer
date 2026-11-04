// Aleatorio: una muestra fija de partidas del banco, en cada push. Las 2 000 semillas están en
// cage-colors.corpus.test.ts.
import { readFileSync } from "node:fs";
import { manifestSchema, regenerateSeed } from "@sudoku-killer/bank";
import type { PublicPuzzle } from "@sudoku-killer/protocol";
import { describe, expect, it } from "vitest";
import { cageColors, cageNeighbours, colorGraph, paletteOrder } from "../src/game/cage-colors.ts";
import { colorIssues, publicPuzzleOf } from "./helpers/cage-colors.ts";

const manifest = manifestSchema.parse(
  JSON.parse(readFileSync(new URL("../../server/bank/manifest.json", import.meta.url), "utf8")),
);

/** Las tres primeras semillas de cada dificultad. */
function sample(): PublicPuzzle[] {
  const taken = new Map<string, number>();
  const seeds = manifest.entries.filter((entry) => {
    const count = taken.get(entry.difficulty) ?? 0;
    taken.set(entry.difficulty, count + 1);
    return count < 3;
  });
  return seeds.map((entry) =>
    publicPuzzleOf(regenerateSeed(entry.seed).generated.puzzle, `seed-${String(entry.seed)}`),
  );
}

describe("T-43.1 Aleatorio colours the cages with no equal neighbours and never runs out", () => {
  const puzzles = sample();

  it("takes a sample of every difficulty of the bank", () => {
    const difficulties = new Set(manifest.entries.map((entry) => entry.difficulty));
    expect(puzzles.length).toBe(difficulties.size * 3);
  });

  it("the sample has colours for every cage, at most 6 and no equal neighbours", () => {
    for (const puzzle of puzzles) expect(colorIssues(puzzle), puzzle.id).toEqual([]);
  });

  it("the same id gives the same colours", () => {
    for (const puzzle of puzzles) expect(cageColors(puzzle)).toEqual(cageColors({ ...puzzle }));
  });

  it("the order of the palette is a permutation of the nine colours", () => {
    for (const id of ["a", "b", "seed-1", ""])
      expect([...paletteOrder(id)].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("removes the vertex of lowest degree first: a path needs only two colours", () => {
    const path = [[1], [0, 2], [1, 3], [2, 4], [3]];
    const colors = colorGraph(path, [1, 2, 3]);
    expect(new Set(colors).size).toBe(2);
  });

  it("colours in the inverse order of removal: two adjacent stars need only two colours", () => {
    // Si los centros se colorearan al final, las hojas ya tendrían el primer color y harían falta tres.
    const stars = [[1, 2, 3, 4], [0, 5, 6, 7], [0], [0], [0], [1], [1], [1]];
    expect(new Set(colorGraph(stars, [1, 2, 3, 4, 5, 6, 7, 8, 9])).size).toBe(2);
  });

  it("negative check: with a K10 there are not enough colours, and it returns null", () => {
    const k10 = Array.from({ length: 10 }, (_, a) =>
      Array.from({ length: 10 }, (_, b) => b).filter((b) => b !== a),
    );
    expect(colorGraph(k10, paletteOrder("k10"))).toBeNull();
  });

  it("negative check: the detector marks equal neighbours, a missing colour and too many colours", () => {
    const puzzle = puzzles[0];
    if (!puzzle) throw new Error("No puzzle");
    const [first] = cageNeighbours(puzzle);
    const neighbour = first?.[0];
    if (neighbour === undefined) throw new Error("No neighbour");
    const colors = cageColors(puzzle);
    if (!colors) throw new Error("No colours");

    const equal = [...colors];
    equal[neighbour] = equal[0] ?? 0;
    expect(colorIssues(puzzle, equal).join()).toMatch(/equal neighbours/);

    const missing = [...colors];
    missing[0] = 0;
    expect(colorIssues(puzzle, missing).join()).toMatch(/without a colour/);

    expect(colorIssues(puzzle, null)).toEqual(["ran out of colours"]);

    const many = puzzle.cages.map((_, i) => (i % 9) + 1);
    expect(colorIssues(puzzle, many).join()).toMatch(/more than 6 colours/);
  });
});
