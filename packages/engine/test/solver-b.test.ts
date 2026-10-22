// T-35.1 (parte del solver B): B encuentra exactamente las soluciones de la fuerza bruta en 4×4,
// coincide con A y respeta la misma semántica de `count` y `limit`.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { solveA, solveB, type KillerPuzzle } from "@sudoku-killer/engine";
import { at } from "../src/model/at.ts";
import { bruteForce4, gridKeys } from "./helpers/brute-force.ts";
import { GEOMETRY_4, GEOMETRY_9, killerArb } from "./helpers/grids.ts";
import {
  addGivensUntilUnique,
  boxCagesPuzzle,
  expectValidSolutions,
  pairsPuzzle,
  shiftFirstSum,
  variantArb,
} from "./helpers/puzzles.ts";

describe("T-35.1 solver B against the 4x4 brute force and solver A", () => {
  it("finds exactly the brute-force solutions of random puzzles, like A", () => {
    fc.assert(
      fc.property(variantArb(GEOMETRY_4), (puzzle) => {
        const expected = gridKeys(bruteForce4(puzzle));
        const all = solveB(puzzle, { limit: Infinity });
        expectValidSolutions(puzzle, all.solutions);
        expect(gridKeys(all.solutions)).toEqual(expected);
        expect(gridKeys(solveA(puzzle, { limit: Infinity }).solutions)).toEqual(expected);
        expect(solveB(puzzle).count).toBe(Math.min(expected.length, 2));
        expect(solveB(puzzle).count).toBe(solveA(puzzle).count);
      }),
      { numRuns: 300 },
    );
  });

  it("0 solutions: a cage sum off by one breaks the board total", () => {
    const broken = shiftFirstSum(pairsPuzzle(GEOMETRY_4).puzzle);
    expect(bruteForce4(broken)).toEqual([]);
    expect(solveB(broken)).toMatchObject({ count: 0, solutions: [] });
  });

  it("1 solution: the same unique puzzle as A, with the grid it was built from", () => {
    const { puzzle, grid } = pairsPuzzle(GEOMETRY_4);
    const unique = addGivensUntilUnique(puzzle, grid);
    expect(bruteForce4(unique)).toEqual([grid]);
    expect(solveB(unique).solutions).toEqual([grid]);
  });

  it("2 or more: box cages are an empty sudoku, and the limit stops the search", () => {
    const puzzle = boxCagesPuzzle();
    const expected = gridKeys(bruteForce4(puzzle));
    expect(expected).toHaveLength(288);
    expect(gridKeys(solveB(puzzle, { limit: Infinity }).solutions)).toEqual(expected);
    for (const limit of [1, 2, 5]) {
      const result = solveB(puzzle, { limit });
      expect(result.solutions).toHaveLength(limit);
      expect(result.count).toBe(Math.min(limit, 2));
      expectValidSolutions(puzzle, result.solutions);
    }
  });
});

describe("solver B on 9x9", () => {
  it("is deterministic", () => {
    fc.assert(
      fc.property(variantArb(GEOMETRY_9, 3), (puzzle) => {
        expect(solveB(puzzle)).toEqual(solveB(puzzle));
      }),
      { numRuns: 5 },
    );
  });

  it("detects a broken board total", () => {
    fc.assert(
      fc.property(killerArb(GEOMETRY_9), ({ puzzle }) => {
        expect(solveB(shiftFirstSum(puzzle))).toMatchObject({ count: 0, solutions: [] });
      }),
      { numRuns: 10 },
    );
  });
});

describe("solver B input checks", () => {
  const { puzzle } = pairsPuzzle(GEOMETRY_4);
  const first = at(puzzle.cages, 0);

  it.each<[string, KillerPuzzle]>([
    ["a missing cage", { ...puzzle, cages: puzzle.cages.slice(1) }],
    ["overlapping cages", { ...puzzle, cages: [...puzzle.cages, first] }],
    ["a one-cell cage", { ...puzzle, cages: [{ ...first, cells: [0] }, ...puzzle.cages] }],
    ["an invalid geometry", { ...puzzle, boxCols: 3 }],
    ["a given out of range", { ...puzzle, givens: [{ cell: 16, value: 1 }] }],
    ["a given value out of range", { ...puzzle, givens: [{ cell: 0, value: 5 }] }],
    [
      "a repeated given cell",
      {
        ...puzzle,
        givens: [
          { cell: 0, value: 1 },
          { cell: 0, value: 1 },
        ],
      },
    ],
  ])("rejects %s", (_, invalid) => {
    expect(() => solveB(invalid)).toThrow(RangeError);
  });

  it("rejects an invalid limit", () => {
    for (const limit of [0, -1, 1.5, NaN]) {
      expect(() => solveB(puzzle, { limit })).toThrow(RangeError);
    }
  });

  it("returns 0 solutions for an unreachable sum, which validateStructure rejects", () => {
    const unreachable = { ...puzzle, cages: [{ ...first, sum: 2 }, ...puzzle.cages.slice(1)] };
    expect(solveB(unreachable)).toMatchObject({ count: 0, solutions: [] });
  });
});
