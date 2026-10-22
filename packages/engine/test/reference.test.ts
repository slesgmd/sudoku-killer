// T-35.2: los puzzles de referencia conservan el resultado que calcularon A y B y confirmó el
// validador. T-35.1: A y B lo reproducen, y en 4×4 también la fuerza bruta.
import { describe, expect, it } from "vitest";
import { solveA, solveB, validateSolution, validateStructure } from "@sudoku-killer/engine";
import { REFERENCE_CASES, toGrid, toPuzzle } from "./fixtures/reference-puzzles.ts";
import { bruteForce4, gridKeys } from "./helpers/brute-force.ts";

describe("T-35.2 reference puzzles", () => {
  it.each(REFERENCE_CASES.map((reference) => [reference.name, reference] as const))(
    "%s",
    (_, reference) => {
      const puzzle = toPuzzle(reference);
      expect(validateStructure(puzzle)).toEqual([]);
      const expected = reference.solutions.map(toGrid);
      for (const solution of expected) expect(validateSolution(puzzle, solution)).toEqual([]);

      for (const solve of [solveA, solveB]) {
        expect(gridKeys(solve(puzzle, { limit: Infinity }).solutions)).toEqual(gridKeys(expected));
        expect(solve(puzzle).count).toBe(Math.min(expected.length, 2));
      }
      if (puzzle.size === 4) expect(gridKeys(bruteForce4(puzzle))).toEqual(gridKeys(expected));
    },
  );

  it("cover 0, 1 and several solutions in every size", () => {
    for (const size of [4, 6, 9]) {
      const counts = REFERENCE_CASES.filter((reference) => reference.geometry.size === size).map(
        (reference) => Math.min(reference.solutions.length, 2),
      );
      expect(new Set(counts)).toEqual(new Set([0, 1, 2]));
    }
  });
});
