// T-35.1: los solvers A y B devuelven el mismo número de soluciones y, cuando se pueden enumerar,
// las mismas soluciones. Una discrepancia es un error de un solver.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { solveA, solveB, type Geometry, type KillerPuzzle } from "@sudoku-killer/engine";
import { gridKeys } from "./helpers/brute-force.ts";
import { GEOMETRY_6, GEOMETRY_9, killerArb } from "./helpers/grids.ts";
import { assertProperty, seedMessage } from "./helpers/property.ts";
import {
  expectValidSolutions,
  givensChain,
  killerWithGivensArb,
  shiftFirstSum,
  variantArb,
} from "./helpers/puzzles.ts";

/** Hasta aquí se enumeran todas las soluciones y se comparan como conjuntos. */
const SMALL = 12;

/** Margen para las propiedades 9×9; en local tardan unos pocos segundos en total. */
const SLOW = { timeout: 60_000 };

/**
 * Compara A y B en un puzzle: el `count` con el límite por defecto y las primeras `SMALL + 1`
 * soluciones. Si hay como mucho `SMALL`, las dos búsquedas son completas y los conjuntos deben ser
 * iguales. Devuelve cuántas soluciones tiene (`SMALL + 1` significa «más de SMALL»).
 */
function compare(puzzle: KillerPuzzle): number {
  const a = solveA(puzzle);
  const b = solveB(puzzle);
  expect(b.count).toBe(a.count);
  expectValidSolutions(puzzle, a.solutions);
  expectValidSolutions(puzzle, b.solutions);
  if (a.count === 1) expect(b.solutions).toEqual(a.solutions);

  const allA = solveA(puzzle, { limit: SMALL + 1 }).solutions;
  const allB = solveB(puzzle, { limit: SMALL + 1 }).solutions;
  expect(allB.length).toBe(allA.length);
  expectValidSolutions(puzzle, allB);
  if (allA.length <= SMALL) expect(gridKeys(allB)).toEqual(gridKeys(allA));
  return allA.length;
}

/**
 * Por tamaño: cadenas, variantes y números iniciales de partida. En 9×9 se parte de 3 números
 * iniciales: sin ellos, B tarda hasta varios segundos en algunos puzzles con muchas soluciones
 * (docs/motor.md). Esos casos se comparan en la medición de 1000 puzzles y en el corpus del generador.
 */
describe.each<[Geometry, number, number, number]>([
  [GEOMETRY_6, 30, 40, 0],
  [GEOMETRY_9, 12, 20, 3],
])("T-35.1 solvers A and B agree ($size)", (geometry, chains, variants, givens) => {
  it("along a chain of givens: many solutions, a few (same set) and one (the grid)", SLOW, () => {
    let smallSets = 0;
    const seed = assertProperty(
      fc.property(killerWithGivensArb(geometry, givens), ({ puzzle, grid }) => {
        const chain = givensChain(puzzle, grid);
        for (const step of chain) {
          const count = compare(step);
          if (count >= 2 && count <= SMALL) smallSets++;
        }
        const last = chain.at(-1);
        expect(last && solveB(last).solutions).toEqual([grid]);
      }),
      { numRuns: chains },
    );
    // Las cadenas pasan casi siempre por puzzles con pocas soluciones; si no, la prueba no
    // compararía conjuntos de varias soluciones.
    expect(smallSets, seedMessage(seed)).toBeGreaterThan(0);
  });

  it("on variants with 0 solutions, wrong givens or shifted sums", SLOW, () => {
    assertProperty(
      fc.property(variantArb(geometry, givens), (puzzle) => {
        compare(puzzle);
      }),
      { numRuns: variants },
    );
  });

  it("when the board total is broken", SLOW, () => {
    assertProperty(
      fc.property(killerArb(geometry), ({ puzzle }) => {
        expect(compare(shiftFirstSum(puzzle))).toBe(0);
      }),
      { numRuns: 5 },
    );
  });
});
