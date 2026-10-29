// Generador. T-35.6: la misma semilla y las mismas opciones dan el mismo puzzle. T-20.1: todo
// puzzle generado tiene una estructura válida y solución única según A y B. T-20.2: hay números
// iniciales solo si `givensReason` es `difficulty` o `uniqueness`; `addGivens` los toma de la solución,
// repartidos por cajas y con su guarda. Versión rápida para la CI; el corpus de 1000 puzzles está en
// `generator.corpus.test.ts` (`pnpm test:corpus`).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addGivens,
  generatePuzzle,
  grade,
  layoutOf,
  type GeneratedPuzzle,
  type Geometry,
  type GradeResult,
} from "@sudoku-killer/engine";
import { expectSoundPuzzle } from "./helpers/generated.ts";
import { GEOMETRY_4, GEOMETRY_6, GEOMETRY_9 } from "./helpers/grids.ts";
import { assertProperty, seedMessage } from "./helpers/property.ts";

const seedArb = fc.nat({ max: 0xffff_ffff });

/** Margen para las propiedades 9×9; en local tardan alrededor de un segundo. */
const SLOW = { timeout: 60_000 };

describe.each<[Geometry, number]>([
  [GEOMETRY_4, 60],
  [GEOMETRY_6, 30],
  [GEOMETRY_9, 15],
])("generator ($size)", (geometry, numRuns) => {
  it(
    "T-20.1 / T-20.2: valid cages, unique solution for A and B, givens only with a reason",
    SLOW,
    () => {
      assertProperty(
        fc.property(seedArb, (seed) => {
          expectSoundPuzzle(generatePuzzle({ seed, geometry }));
        }),
        { numRuns },
      );
    },
  );

  it("T-35.6: the same seed and options give the same puzzle", SLOW, () => {
    assertProperty(
      fc.property(seedArb, fc.integer({ min: 0, max: 3 }), (seed, extra) => {
        const options = { seed, geometry };
        const generated = generatePuzzle(options);
        expect(generatePuzzle(options)).toEqual(generated);
        const count = generated.puzzle.givens.length + extra;
        expect(addGivens(generated, { count, seed })).toEqual(
          addGivens(generated, { count, seed }),
        );
      }),
      { numRuns: Math.ceil(numRuns / 3) },
    );
  });
});

describe("generator options", () => {
  it("different seeds give different puzzles", () => {
    const keys = new Set(
      Array.from({ length: 20 }, (_, seed) => JSON.stringify(generatePuzzle({ seed }).puzzle)),
    );
    expect(keys.size).toBe(20);
  });

  it("without cage adjustments, uniqueness comes from givens", () => {
    let withGivens = 0;
    const seed = assertProperty(
      fc.property(seedArb, (seed) => {
        const generated = generatePuzzle({ seed, geometry: GEOMETRY_6, maxAdjustments: 0 });
        expect(generated.stats.adjustments).toBe(0);
        expectSoundPuzzle(generated);
        if (generated.givensReason === "uniqueness") withGivens++;
      }),
      { numRuns: 20 },
    );
    expect(withGivens, seedMessage(seed)).toBeGreaterThan(0);
  });

  it("discards a candidate when solver A runs out of its node budget", () => {
    // Con 2 nodos, A no puede ramificar: solo acepta los puzzles que la propagación cierra en la
    // raíz, y descarta los demás candidatos.
    let discarded = 0;
    const seed = assertProperty(
      fc.property(seedArb, (seed) => {
        const options = { seed, maxNodes: 2 };
        const generated = generatePuzzle(options);
        expectSoundPuzzle(generated);
        const { candidates } = generated.stats;
        discarded += generated.stats.discarded;
        if (candidates > 1) {
          expect(() => generatePuzzle({ ...options, maxCandidates: candidates - 1 })).toThrow(
            `No puzzle accepted after ${String(candidates - 1)} candidates`,
          );
        }
      }),
      { numRuns: 10 },
    );
    expect(discarded, seedMessage(seed)).toBeGreaterThan(0);
  });

  it("rejects invalid options", () => {
    for (const seed of [-1, 1.5, 2 ** 32, NaN]) {
      expect(() => generatePuzzle({ seed })).toThrow(RangeError);
    }
    expect(() =>
      generatePuzzle({ seed: 1, geometry: { size: 2, boxRows: 1, boxCols: 2 } }),
    ).toThrow(RangeError);
    expect(() =>
      generatePuzzle({ seed: 1, geometry: { size: 6, boxRows: 2, boxCols: 2 } }),
    ).toThrow(RangeError);
    expect(() => generatePuzzle({ seed: 1, maxAdjustments: 1.5 })).toThrow(RangeError);
    expect(() => generatePuzzle({ seed: 1, maxNodes: 0 })).toThrow(RangeError);
    expect(() => generatePuzzle({ seed: 1, cageSizeWeights: [0, 0, 0, 0] })).toThrow(RangeError);
  });
});

/** Números iniciales agregados en cada caja. */
function addedPerBox(before: GeneratedPuzzle, after: GeneratedPuzzle): number[] {
  const { boxOf, geometry } = layoutOf(after.puzzle);
  const old = new Set(before.puzzle.givens.map(({ cell }) => cell));
  const counts = new Array<number>(geometry.size).fill(0);
  for (const { cell } of after.puzzle.givens) {
    const box = boxOf[cell] ?? 0;
    if (!old.has(cell)) counts[box] = (counts[box] ?? 0) + 1;
  }
  return counts;
}

/** Piso de la dificultad difícil: algún paso de nivel 3 si se resuelve. */
const needsLevelThree = (result: GradeResult): boolean =>
  result.status !== "solved" || (result.stepsByLevel[3] ?? 0) > 0;

describe("addGivens", () => {
  it(
    "T-20.2: givens come from the solution, A and B stay unique, givensReason is difficulty",
    SLOW,
    () => {
      assertProperty(
        fc.property(seedArb, fc.integer({ min: 1, max: 30 }), (seed, extra) => {
          const base = generatePuzzle({ seed });
          const count = base.puzzle.givens.length + extra;
          const added = addGivens(base, { count, seed });
          if (!added) throw new Error("Without a guard the count is always reached");
          expect(added.generated.givensReason).toBe("difficulty");
          expect(added.generated.solution).toEqual(base.solution);
          expect(added.generated.puzzle.cages).toEqual(base.puzzle.cages);
          expectSoundPuzzle(added.generated, extra);
          expect(added.result).toEqual(grade(added.generated.puzzle));
        }),
        { numRuns: 8 },
      );
    },
  );

  it("spreads the added givens across the boxes", () => {
    assertProperty(
      fc.property(seedArb, fc.integer({ min: 1, max: 40 }), (seed, extra) => {
        const base = generatePuzzle({ seed, geometry: GEOMETRY_9 });
        const added = addGivens(base, { count: base.puzzle.givens.length + extra, seed });
        if (!added) throw new Error("Without a guard the count is always reached");
        const counts = addedPerBox(base, added.generated);
        expect(counts.reduce((a, b) => a + b, 0)).toBe(extra);
        // Una vuelta por todas las cajas antes de repetir: como mucho 1 de diferencia, salvo que
        // los números de unicidad dejen una caja sin celdas libres.
        if (base.puzzle.givens.length === 0) {
          expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 20 },
    );
  });

  it("with a guard, the result meets it and is graded with every given", SLOW, () => {
    let reached = 0;
    const seed = assertProperty(
      fc.property(seedArb, (seed) => {
        const base = generatePuzzle({ seed });
        const added = addGivens(base, { count: 10, seed, keep: needsLevelThree });
        if (!added) return;
        reached++;
        expect(added.generated.puzzle.givens).toHaveLength(10);
        expect(added.result).toEqual(grade(added.generated.puzzle));
        expect(needsLevelThree(added.result)).toBe(true);
      }),
      { numRuns: 6 },
    );
    expect(reached, seedMessage(seed)).toBeGreaterThan(0);
  });

  it("returns null if the guard rejects every given, and changes nothing if the count is met", () => {
    const base = generatePuzzle({ seed: 7 });
    const count = base.puzzle.givens.length;
    expect(addGivens(base, { count: count + 1, seed: 7, keep: () => false })).toBeNull();
    expect(addGivens(base, { count, seed: 7 })?.generated).toEqual(base);
  });

  it("rejects invalid options", () => {
    const base = generatePuzzle({ seed: 1 });
    for (const count of [-1, 1.5, 82]) {
      expect(() => addGivens(base, { count, seed: 1 })).toThrow(RangeError);
    }
    expect(() => addGivens(base, { count: 3, seed: -1 })).toThrow(RangeError);
  });
});
