// T-35.1 (parte del solver B): la poda propia de B no pierde ni agrega soluciones. B con poda y B sin
// ella (Dancing Links puro) dan el mismo `count` con `limit: 2` y el mismo conjunto de soluciones.
// Una diferencia es un error de un solver.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { solveB, type Geometry, type KillerPuzzle } from "@sudoku-killer/engine";
import { gridKeys } from "./helpers/brute-force.ts";
import { GEOMETRY_4, GEOMETRY_6, GEOMETRY_9 } from "./helpers/grids.ts";
import { assertProperty, seedMessage } from "./helpers/property.ts";
import {
  expectValidSolutions,
  givensChain,
  killerWithGivensArb,
  variantArb,
} from "./helpers/puzzles.ts";

const PURE = { prune: false } as const;

/** Margen para las propiedades 9×9; en local tardan unos pocos segundos en total. */
const SLOW = { timeout: 60_000 };

/**
 * Compara B con poda y sin ella: el `count` con `limit: 2`, la solución si es única y las primeras
 * `small + 1` soluciones. Si hay como mucho `small`, las dos búsquedas son completas y los
 * conjuntos deben ser iguales. Devuelve cuántas encontró (`small + 1` significa «más de small»).
 */
function comparePure(puzzle: KillerPuzzle, small: number): number {
  const pruned = solveB(puzzle);
  const pure = solveB(puzzle, PURE);
  expect(pure.count).toBe(pruned.count);
  if (pruned.count === 1) expect(pure.solutions).toEqual(pruned.solutions);

  const limit = small === Infinity ? Infinity : small + 1;
  const allPruned = solveB(puzzle, { limit }).solutions;
  const allPure = solveB(puzzle, { ...PURE, limit }).solutions;
  expect(allPure.length).toBe(allPruned.length);
  expectValidSolutions(puzzle, allPure);
  if (allPruned.length <= small) expect(gridKeys(allPure)).toEqual(gridKeys(allPruned));
  return allPruned.length;
}

describe("T-35.1 solver B with and without its own pruning", () => {
  it("4x4: the same complete set of solutions on random puzzles", () => {
    assertProperty(
      fc.property(variantArb(GEOMETRY_4), (puzzle) => {
        comparePure(puzzle, Infinity);
      }),
      { numRuns: 300 },
    );
  });

  // En 9×9 se parte de 15 números iniciales: con menos, Dancing Links puro tarda hasta segundos
  // (docs/motor.md). En 6×6 es rápido sin ninguno.
  describe.each<[Geometry, number, number, number]>([
    [GEOMETRY_6, 0, 30, 40],
    [GEOMETRY_9, 15, 15, 20],
  ])("$size", (geometry, givens, chains, variants) => {
    const SMALL = 12;

    it("along a chain of givens: many solutions, a few (same set) and one", SLOW, () => {
      let smallSets = 0;
      const seed = assertProperty(
        fc.property(killerWithGivensArb(geometry, givens), ({ puzzle, grid }) => {
          const chain = givensChain(puzzle, grid);
          for (const step of chain) {
            const count = comparePure(step, SMALL);
            if (count >= 2 && count <= SMALL) smallSets++;
          }
          const last = chain.at(-1);
          expect(last && solveB(last, PURE).solutions).toEqual([grid]);
        }),
        { numRuns: chains },
      );
      expect(smallSets, seedMessage(seed)).toBeGreaterThan(0);
    });

    it("on variants with 0 solutions, wrong givens or shifted sums", SLOW, () => {
      assertProperty(
        fc.property(variantArb(geometry, givens), (puzzle) => {
          comparePure(puzzle, SMALL);
        }),
        { numRuns: variants },
      );
    });
  });
});
