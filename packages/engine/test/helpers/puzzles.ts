// Puzzles derivados para las pruebas de los solvers (T-35.1): variantes con 0 soluciones o con
// números iniciales, y cadenas de números iniciales hasta la unicidad.
import fc from "fast-check";
import { expect } from "vitest";
import {
  cageSumRange,
  solveA,
  validateSolution,
  validateStructure,
  type Cage,
  type Geometry,
  type Grid,
  type KillerPuzzle,
} from "@sudoku-killer/engine";
import { at } from "../../src/model/at.ts";
import { gridKeys } from "./brute-force.ts";
import { GEOMETRY_4, killerArb, patternGrid } from "./grids.ts";

/** Puzzle 4×4 cuyas jaulas son las cajas: equivale a un sudoku vacío. */
export function boxCagesPuzzle(): KillerPuzzle {
  const cages: Cage[] = [
    [0, 1, 4, 5],
    [2, 3, 6, 7],
    [8, 9, 12, 13],
    [10, 11, 14, 15],
  ].map((cells, id) => ({ id, cells, sum: 10 }));
  return { ...GEOMETRY_4, cages, givens: [] };
}

/** Jaulas horizontales de 2 celdas sobre la cuadrícula del patrón. */
export function pairsPuzzle(geometry: Geometry): { puzzle: KillerPuzzle; grid: Grid } {
  const grid = patternGrid(geometry);
  const cages: Cage[] = Array.from({ length: grid.length / 2 }, (_, id) => ({
    id,
    cells: [2 * id, 2 * id + 1],
    sum: at(grid, 2 * id) + at(grid, 2 * id + 1),
  }));
  return { puzzle: { ...geometry, cages, givens: [] }, grid };
}

/**
 * El puzzle con la suma de una jaula desplazada en 1, hacia donde sigue siendo alcanzable: la
 * estructura es válida, pero el total del tablero ya no cuadra. Usa la primera jaula cuya suma
 * admite otro valor (una de `size` celdas tiene la suma fija).
 */
export function shiftFirstSum(puzzle: KillerPuzzle): KillerPuzzle {
  const target = puzzle.cages.find((cage) => {
    const [min, max] = cageSumRange(cage.cells.length, puzzle.size);
    return min < max;
  });
  if (!target) throw new RangeError("No cage sum can be shifted");
  const [, max] = cageSumRange(target.cells.length, puzzle.size);
  const sum = target.sum < max ? target.sum + 1 : target.sum - 1;
  return {
    ...puzzle,
    cages: puzzle.cages.map((cage) => (cage === target ? { ...cage, sum } : cage)),
  };
}

/** Puzzle aleatorio con `count` números iniciales tomados de su cuadrícula. */
export function killerWithGivensArb(
  geometry: Geometry,
  count: number,
): fc.Arbitrary<{ puzzle: KillerPuzzle; grid: Grid }> {
  return killerArb(geometry).chain(({ puzzle, grid }) =>
    fc
      .uniqueArray(fc.nat({ max: grid.length - 1 }), { minLength: count, maxLength: count })
      .map((cells) => ({
        puzzle: { ...puzzle, givens: cells.map((cell) => ({ cell, value: at(grid, cell) })) },
        grid,
      })),
  );
}

/**
 * Puzzle aleatorio con números iniciales de su cuadrícula (de `minGivens` a 4, o `minGivens` si
 * es mayor) y, a veces, una suma desplazada en ±1 o un número inicial que no es el de la
 * cuadrícula. La estructura sigue siendo válida.
 */
export function variantArb(geometry: Geometry, minGivens = 0): fc.Arbitrary<KillerPuzzle> {
  return killerArb(geometry).chain(({ puzzle, grid }) =>
    fc
      .record({
        givenCells: fc.uniqueArray(fc.nat({ max: grid.length - 1 }), {
          minLength: minGivens,
          maxLength: Math.max(4, minGivens),
        }),
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

/** Toda solución pasa el validador y no hay soluciones repetidas. */
export function expectValidSolutions(puzzle: KillerPuzzle, solutions: readonly Grid[]): void {
  for (const solution of solutions) expect(validateSolution(puzzle, solution)).toEqual([]);
  expect(new Set(gridKeys(solutions)).size).toBe(solutions.length);
}

/**
 * Agrega números iniciales de `grid` donde las dos primeras soluciones de A difieren, hasta que el
 * puzzle tenga solución única. Devuelve la cadena entera: el puzzle de partida, los intermedios
 * (con dos o más soluciones, cada vez menos) y, al final, el único. Comprueba cada paso.
 */
export function givensChain(puzzle: KillerPuzzle, grid: Grid): KillerPuzzle[] {
  const chain = [puzzle];
  for (let current = puzzle; ;) {
    const result = solveA(current);
    expectValidSolutions(current, result.solutions);
    expect(result.count).toBeGreaterThan(0);
    if (result.count === 1) return chain;
    const [first, second] = result.solutions;
    const cell = (first ?? []).findIndex((digit, i) => digit !== second?.[i]);
    expect(cell).toBeGreaterThanOrEqual(0);
    current = { ...current, givens: [...current.givens, { cell, value: at(grid, cell) }] };
    chain.push(current);
  }
}

/** El último puzzle de `givensChain`: el primero con solución única. */
export function addGivensUntilUnique(puzzle: KillerPuzzle, grid: Grid): KillerPuzzle {
  const chain = givensChain(puzzle, grid);
  return at(chain, chain.length - 1);
}
