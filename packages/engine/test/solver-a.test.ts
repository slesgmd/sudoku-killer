// T-35.1 (parte del solver A): cuenta 0, 1 o 2 o más soluciones, toda solución pasa
// validateSolution y, en 4×4, el conjunto de soluciones coincide con la fuerza bruta.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  cageSumRange,
  digitBit,
  solveA,
  validateSolution,
  validateStructure,
  type Cage,
  type Geometry,
  type Grid,
  type KillerPuzzle,
} from "@sudoku-killer/engine";
import { at } from "../src/model/at.ts";
import { cageCombinations } from "../src/solver-a/combos.ts";
import { bruteForce4, gridKeys } from "./helpers/brute-force.ts";
import { GEOMETRY_4, GEOMETRY_6, GEOMETRY_9, killerArb, patternGrid } from "./helpers/grids.ts";

/** Puzzle 4×4 cuyas jaulas son las cajas: equivale a un sudoku vacío. */
function boxCagesPuzzle(): KillerPuzzle {
  const cages: Cage[] = [
    [0, 1, 4, 5],
    [2, 3, 6, 7],
    [8, 9, 12, 13],
    [10, 11, 14, 15],
  ].map((cells, id) => ({ id, cells, sum: 10 }));
  return { ...GEOMETRY_4, cages, givens: [] };
}

/** Jaulas horizontales de 2 celdas sobre la cuadrícula del patrón. */
function pairsPuzzle(geometry: Geometry): { puzzle: KillerPuzzle; grid: Grid } {
  const grid = patternGrid(geometry);
  const cages: Cage[] = Array.from({ length: grid.length / 2 }, (_, id) => ({
    id,
    cells: [2 * id, 2 * id + 1],
    sum: at(grid, 2 * id) + at(grid, 2 * id + 1),
  }));
  return { puzzle: { ...geometry, cages, givens: [] }, grid };
}

/**
 * Puzzle aleatorio con números iniciales de su cuadrícula y, a veces, una suma desplazada en ±1 o
 * un número inicial que no es el de la cuadrícula. La estructura sigue siendo válida.
 */
function variantArb(geometry: Geometry): fc.Arbitrary<KillerPuzzle> {
  return killerArb(geometry).chain(({ puzzle, grid }) =>
    fc
      .record({
        givenCells: fc.uniqueArray(fc.nat({ max: grid.length - 1 }), { maxLength: 4 }),
        cage: fc.nat({ max: puzzle.cages.length - 1 }),
        delta: fc.constantFrom(-1, 0, 0, 1),
        wrong: fc.option(fc.integer({ min: 1, max: puzzle.size - 1 }), { freq: 4 }),
      })
      .map(({ givenCells, cage, delta, wrong }) => {
        const target = at(puzzle.cages, cage);
        const [min, max] = cageSumRange(target.cells.length, puzzle.size);
        const sum = Math.min(max, Math.max(min, target.sum + delta));
        const givens = givenCells.map((cell, i) => {
          const value = at(grid, cell);
          // El primero, desplazado en `wrong` dentro de 1..size: nunca coincide con la cuadrícula.
          return {
            cell,
            value: i === 0 && wrong ? ((value - 1 + wrong) % puzzle.size) + 1 : value,
          };
        });
        return {
          ...puzzle,
          cages: puzzle.cages.map((c) => (c === target ? { ...c, sum } : c)),
          givens,
        };
      })
      .filter((variant) => validateStructure(variant).length === 0),
  );
}

function expectValidSolutions(puzzle: KillerPuzzle, solutions: readonly Grid[]): void {
  for (const solution of solutions) expect(validateSolution(puzzle, solution)).toEqual([]);
  expect(new Set(gridKeys(solutions)).size).toBe(solutions.length);
}

/**
 * Agrega números iniciales de `grid` donde las dos primeras soluciones difieren, hasta que el
 * puzzle tenga solución única. Comprueba cada resultado por el camino.
 */
function addGivensUntilUnique(puzzle: KillerPuzzle, grid: Grid): KillerPuzzle {
  let current = puzzle;
  for (;;) {
    const result = solveA(current);
    expectValidSolutions(current, result.solutions);
    expect(result.count).toBeGreaterThan(0);
    if (result.count === 1) return current;
    const [first, second] = result.solutions;
    const cell = (first ?? []).findIndex((digit, i) => digit !== second?.[i]);
    expect(cell).toBeGreaterThanOrEqual(0);
    current = { ...current, givens: [...current.givens, { cell, value: at(grid, cell) }] };
  }
}

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
    const { puzzle } = pairsPuzzle(GEOMETRY_4);
    const first = at(puzzle.cages, 0);
    const broken = {
      ...puzzle,
      cages: [{ ...first, sum: first.sum + 1 }, ...puzzle.cages.slice(1)],
    };
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
