// `levelsToDeduce` y los descartes públicos. T-35.7: una sola pasada da el mismo nivel que
// `levelToDeduce` en cada celda, y sus puntos fijos por nivel son coherentes con esos niveles y con
// la solución. T-35.8: descartar dígitos de errores (nunca el de la solución) no contradice la
// solución y no sube ningún nivel. Si una celda tiene 2 candidatos en el punto fijo del nivel L y
// se descarta el falso, queda de nivel ≤ L; si los tiene sin técnicas, de nivel 1.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MAX_TECHNIQUE_LEVEL,
  UNRATED,
  digitBit,
  generatePuzzle,
  levelToDeduce,
  levelsToDeduce,
  popcount,
  type Exclusion,
  type Geometry,
  type Grid,
} from "@sudoku-killer/engine";
import { at } from "../src/model/at.ts";
import { boardWith } from "./helpers/grader.ts";
import { GEOMETRY_4, GEOMETRY_6, GEOMETRY_9 } from "./helpers/grids.ts";
import { assertProperty } from "./helpers/property.ts";

const seedArb = fc.nat({ max: 0xffff_ffff });
const SLOW = { timeout: 120_000 };

/** Descartes de dígitos que no son los de la solución, en celdas vacías (como errores públicos). */
function wrongDigits(
  solution: Grid,
  values: readonly number[],
  raw: readonly (readonly [number, number])[],
  size: number,
): Exclusion[] {
  return raw.flatMap(([cell, digit]) => {
    const c = cell % solution.length;
    const d = (digit % size) + 1;
    return at(values, c) === 0 && d !== at(solution, c) ? [{ cell: c, digit: d }] : [];
  });
}

describe.each<[Geometry, number]>([
  [GEOMETRY_4, 60],
  [GEOMETRY_6, 30],
  [GEOMETRY_9, 10],
])("levelsToDeduce ($size)", (geometry, numRuns) => {
  const cellCount = geometry.size * geometry.size;
  const stateArb = fc.tuple(
    seedArb,
    fc.uniqueArray(fc.nat({ max: cellCount - 1 })),
    fc.array(fc.tuple(fc.nat(), fc.nat()), { maxLength: 12 }),
  );

  it("T-35.7: one pass gives levelToDeduce for every cell, with coherent fixpoints", SLOW, () => {
    assertProperty(
      fc.property(stateArb, ([seed, cells, raw]) => {
        const { puzzle, solution } = generatePuzzle({ seed, geometry });
        const values = boardWith(solution, cells);
        const excluded = wrongDigits(solution, values, raw, geometry.size);
        const board = { puzzle, values, excluded };
        const { levels, fixpoints } = levelsToDeduce(board);
        const givens = new Set(puzzle.givens.map(({ cell }) => cell));

        expect(fixpoints).toHaveLength(MAX_TECHNIQUE_LEVEL + 1);
        for (let cell = 0; cell < cellCount; cell++) {
          if (at(values, cell) !== 0 || givens.has(cell)) {
            expect(at(levels, cell)).toBe(0);
            continue;
          }
          const level = at(levels, cell);
          expect(level, `cell ${String(cell)}`).toBe(levelToDeduce(cell, board));
          for (let l = 1; l <= MAX_TECHNIQUE_LEVEL; l++) {
            const mask = at(at(fixpoints, l), cell);
            // La solución nunca sale de los candidatos (los descartes son siempre errores).
            expect(mask & digitBit(at(solution, cell))).not.toBe(0);
            expect(popcount(mask) === 1, `cell ${String(cell)}, level ${String(l)}`).toBe(
              level <= l,
            );
          }
        }
        // Cada punto fijo tiene a lo sumo los candidatos del anterior.
        for (let l = 1; l <= MAX_TECHNIQUE_LEVEL; l++) {
          for (let cell = 0; cell < cellCount; cell++) {
            const mask = at(at(fixpoints, l), cell);
            expect(mask & ~at(at(fixpoints, l - 1), cell)).toBe(0);
          }
        }
      }),
      { numRuns },
    );
  });

  it("T-35.8: more public exclusions never raise a level", SLOW, () => {
    assertProperty(
      fc.property(stateArb, fc.nat(), ([seed, cells, raw], split) => {
        const { puzzle, solution } = generatePuzzle({ seed, geometry });
        const values = boardWith(solution, cells);
        const excluded = wrongDigits(solution, values, raw, geometry.size);
        const few = excluded.slice(0, split % (excluded.length + 1));
        const withFew = levelsToDeduce({ puzzle, values, excluded: few }).levels;
        const withAll = levelsToDeduce({ puzzle, values, excluded }).levels;
        const without = levelsToDeduce({ puzzle, values }).levels;
        for (let cell = 0; cell < cellCount; cell++) {
          expect(at(withAll, cell)).toBeLessThanOrEqual(at(withFew, cell));
          expect(at(withFew, cell)).toBeLessThanOrEqual(at(without, cell));
        }
      }),
      { numRuns },
    );
  });
});

describe("public exclusions (9x9)", () => {
  it("T-35.8: with 2 candidates at level L and the wrong one excluded, the level is at most L", () => {
    const { puzzle, solution } = generatePuzzle({ seed: 3 });
    const values = boardWith(solution, []);
    const { levels, fixpoints } = levelsToDeduce({ puzzle, values });
    // Una celda de nivel mayor que 1 con 2 candidatos en algún punto fijo.
    let found = false;
    for (let l = 1; l < MAX_TECHNIQUE_LEVEL && !found; l++) {
      for (let cell = 0; cell < values.length && !found; cell++) {
        const mask = at(at(fixpoints, l), cell);
        if (at(levels, cell) <= l || popcount(mask) !== 2) continue;
        const wrong = [1, 2, 3, 4, 5, 6, 7, 8, 9].find(
          (d) => (mask & digitBit(d)) !== 0 && d !== at(solution, cell),
        );
        if (wrong === undefined) continue;
        const excluded = [{ cell, digit: wrong }];
        expect(levelToDeduce(cell, { puzzle, values, excluded })).toBeLessThanOrEqual(l);
        found = true;
      }
    }
    expect(found).toBe(true);

    // Con todos los falsos descartados, la celda es un single.
    const cell = 0;
    const others = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => d !== at(solution, cell));
    const excluded = others.map((d) => ({ cell, digit: d }));
    expect(levelToDeduce(cell, { puzzle, values, excluded })).toBe(1);
  });

  it("rejects invalid exclusions, and excluding a placed digit is a contradiction", () => {
    const { puzzle, solution } = generatePuzzle({ seed: 3 });
    const values = boardWith(solution, [0]);
    expect(() => levelToDeduce(1, { puzzle, values, excluded: [{ cell: 81, digit: 1 }] })).toThrow(
      RangeError,
    );
    expect(() => levelToDeduce(1, { puzzle, values, excluded: [{ cell: 1, digit: 0 }] })).toThrow(
      RangeError,
    );
    expect(() => levelsToDeduce({ puzzle, values, excluded: [{ cell: 1, digit: 10 }] })).toThrow(
      RangeError,
    );
    const placed = { cell: 0, digit: at(solution, 0) };
    expect(levelToDeduce(1, { puzzle, values, excluded: [placed] })).toBe(UNRATED);
    expect(levelsToDeduce({ puzzle, values, excluded: [placed] }).levels[1]).toBe(UNRATED);
  });
});
