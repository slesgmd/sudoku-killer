// T-35.1 (parte del solver A): cuenta 0, 1 o 2 o más soluciones, toda solución pasa
// validateSolution y, en 4×4, el conjunto de soluciones coincide con la fuerza bruta.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cageSumRange, digitBit, solveA } from "@sudoku-killer/engine";
import { cageCombinations } from "../src/solver-a/combos.ts";
import { bruteForce4, gridKeys } from "./helpers/brute-force.ts";
import { GEOMETRY_4, GEOMETRY_6, GEOMETRY_9, killerArb } from "./helpers/grids.ts";
import {
  addGivensUntilUnique,
  boxCagesPuzzle,
  expectValidSolutions,
  pairsPuzzle,
  shiftFirstSum,
  variantArb,
} from "./helpers/puzzles.ts";

describe("T-35.1 solver A against the 4x4 brute force", () => {
  it("finds exactly the brute-force solutions of random puzzles", () => {
    fc.assert(
      fc.property(variantArb(GEOMETRY_4), (puzzle) => {
        const expected = bruteForce4(puzzle);
        const all = solveA(puzzle, { limit: Infinity });
        expectValidSolutions(puzzle, all.solutions);
        expect(gridKeys(all.solutions)).toEqual(gridKeys(expected));
        expect(solveA(puzzle).count).toBe(Math.min(expected.length, 2));
      }),
      { numRuns: 300 },
    );
  });

  it("0 solutions: a cage sum off by one breaks the board total", () => {
    const broken = shiftFirstSum(pairsPuzzle(GEOMETRY_4).puzzle);
    expect(bruteForce4(broken)).toEqual([]);
    expect(solveA(broken)).toMatchObject({ count: 0, solutions: [] });
  });

  it("1 solution: givens from the grid make the puzzle unique", () => {
    const { puzzle, grid } = pairsPuzzle(GEOMETRY_4);
    const unique = addGivensUntilUnique(puzzle, grid);
    expect(bruteForce4(unique)).toEqual([grid]);
    expect(solveA(unique).solutions).toEqual([grid]);
  });

  it("2 or more: box cages are an empty sudoku, and the limit stops the search", () => {
    const puzzle = boxCagesPuzzle();
    const expected = bruteForce4(puzzle);
    expect(expected).toHaveLength(288);
    expect(gridKeys(solveA(puzzle, { limit: Infinity }).solutions)).toEqual(gridKeys(expected));
    for (const limit of [1, 2, 5]) {
      const result = solveA(puzzle, { limit });
      expect(result.solutions).toHaveLength(limit);
      expect(result.count).toBe(Math.min(limit, 2));
      expectValidSolutions(puzzle, result.solutions);
    }
  });
});

describe("T-35.1 solver A on 6x6 and 9x9", () => {
  it.each([
    [GEOMETRY_6, 40],
    [GEOMETRY_9, 25],
  ])("random puzzles become unique with givens from their grid ($size)", (geometry, numRuns) => {
    fc.assert(
      fc.property(killerArb(geometry), ({ puzzle, grid }) => {
        const unique = addGivensUntilUnique(puzzle, grid);
        expect(solveA(unique).solutions).toEqual([grid]);
      }),
      { numRuns },
    );
  });

  it("every returned solution is valid, also when a sum is shifted", () => {
    fc.assert(
      fc.property(fc.oneof(variantArb(GEOMETRY_6), variantArb(GEOMETRY_9)), (puzzle) => {
        const result = solveA(puzzle);
        expectValidSolutions(puzzle, result.solutions);
        expect(result.count).toBe(result.solutions.length);
        expect(result.nodes).toBeGreaterThan(0);
      }),
      { numRuns: 60 },
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(variantArb(GEOMETRY_9), (puzzle) => {
        expect(solveA(puzzle)).toEqual(solveA(puzzle));
      }),
      { numRuns: 10 },
    );
  });
});

describe("solver A input checks", () => {
  it("rejects an invalid structure and an invalid limit", () => {
    const { puzzle } = pairsPuzzle(GEOMETRY_4);
    expect(() => solveA({ ...puzzle, cages: puzzle.cages.slice(1) })).toThrow(RangeError);
    for (const limit of [0, -1, 1.5, NaN]) {
      expect(() => solveA(puzzle, { limit })).toThrow(RangeError);
    }
  });
});

describe("T-35.1 cage combination table", () => {
  /** Subconjuntos de `k` dígitos de 1..size, agrupados por suma, como máscaras ordenadas. */
  function subsetsBySum(size: number, k: number): Map<number, number[]> {
    const bySum = new Map<number, number[]>();
    const walk = (from: number, left: number, sum: number, mask: number): void => {
      if (left === 0) {
        bySum.set(sum, [...(bySum.get(sum) ?? []), mask]);
        return;
      }
      for (let digit = from; digit <= size; digit++) {
        walk(digit + 1, left - 1, sum + digit, mask | digitBit(digit));
      }
    };
    walk(1, k, 0, 0);
    for (const masks of bySum.values()) masks.sort((a, b) => a - b);
    return bySum;
  }

  it.each([4, 6, 9, 16])("matches an independent enumeration for size %i", (size) => {
    for (let k = 2; k <= Math.min(5, size); k++) {
      const expected = subsetsBySum(size, k);
      const [min, max] = cageSumRange(k, size);
      for (let sum = min - 1; sum <= max + 1; sum++) {
        expect(cageCombinations(size, k, sum)).toEqual(expected.get(sum) ?? []);
      }
    }
  });

  it("has the forced combinations of a 9x9 board", () => {
    expect(cageCombinations(9, 2, 3)).toEqual([digitBit(1) | digitBit(2)]);
    expect(cageCombinations(9, 2, 17)).toEqual([digitBit(8) | digitBit(9)]);
    expect(cageCombinations(9, 5, 15)).toEqual([0b11111]);
    expect(cageCombinations(9, 2, 10)).toHaveLength(4);
  });
});
