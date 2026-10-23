// Generador (F4d). T-35.6: la misma semilla y las mismas opciones dan el mismo puzzle. T-20.1: todo
// puzzle generado tiene una estructura válida y solución única según A y B. T-20.2: hay números
// iniciales solo si `givensReason` es `easy` o `uniqueness`. Versión rápida para la CI; el corpus de
// 1000 puzzles está en `generator.corpus.test.ts` (`pnpm test:corpus`).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { generatePuzzle, type Geometry } from "@sudoku-killer/engine";
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
      fc.property(seedArb, fc.integer({ min: 0, max: 3 }), (seed, easyGivens) => {
        const options = { seed, geometry, easyGivens };
        expect(generatePuzzle(options)).toEqual(generatePuzzle(options));
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

  it("T-20.2: easy givens come from the solution and set givensReason to easy", SLOW, () => {
    assertProperty(
      fc.property(seedArb, fc.integer({ min: 1, max: 30 }), (seed, easyGivens) => {
        const generated = generatePuzzle({ seed, easyGivens });
        expect(generated.givensReason).toBe("easy");
        expectSoundPuzzle(generated, easyGivens);
      }),
      { numRuns: 8 },
    );
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
    expect(() => generatePuzzle({ seed: 1, easyGivens: -1 })).toThrow(RangeError);
    expect(() => generatePuzzle({ seed: 1, easyGivens: 82 })).toThrow(RangeError);
    expect(() => generatePuzzle({ seed: 1, maxAdjustments: 1.5 })).toThrow(RangeError);
    expect(() => generatePuzzle({ seed: 1, maxNodes: 0 })).toThrow(RangeError);
    expect(() => generatePuzzle({ seed: 1, cageSizeWeights: [0, 0, 0, 0] })).toThrow(RangeError);
  });
});
