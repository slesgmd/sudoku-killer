// Calificador humano (F4e). T-35.4: ninguna deducción contradice la solución, y en cada paso de
// `grade` el dígito de la solución de cada celda sigue entre sus candidatos. T-35.5: `levelToDeduce`
// da un nivel entre 1 y UNRATED, vale 1 en un single y no sube al agregar celdas correctas. Versión
// rápida para la CI; el corpus de 1000 puzzles está en `grader.corpus.test.ts`.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  TECHNIQUES,
  UNRATED,
  generatePuzzle,
  grade,
  layoutOf,
  levelToDeduce,
  type Deduction,
  type Geometry,
} from "@sudoku-killer/engine";
import { at } from "../src/model/at.ts";
import { graderContextOf } from "../src/grader/context.ts";
import { createGraderState } from "../src/grader/state.ts";
import { bruteForce4 } from "./helpers/brute-force.ts";
import { agrees, boardWith, expectCandidatesKeep, expectSoundGrade } from "./helpers/grader.ts";
import { GEOMETRY_4, GEOMETRY_6, GEOMETRY_9, killerArb } from "./helpers/grids.ts";
import { assertProperty } from "./helpers/property.ts";
import { boxCagesPuzzle, shiftFirstSum } from "./helpers/puzzles.ts";

const seedArb = fc.nat({ max: 0xffff_ffff });
const SLOW = { timeout: 60_000 };

describe.each<[Geometry, number]>([
  [GEOMETRY_4, 60],
  [GEOMETRY_6, 30],
  [GEOMETRY_9, 12],
])("grader on generated puzzles ($size)", (geometry, numRuns) => {
  it("T-35.4: lowest level first, and no deduction contradicts the solution", SLOW, () => {
    assertProperty(
      fc.property(seedArb, fc.integer({ min: 0, max: 6 }), (seed, easyGivens) => {
        const { puzzle, solution } = generatePuzzle({ seed, geometry, easyGivens });
        expectSoundGrade(puzzle, solution);
      }),
      { numRuns },
    );
  });

  it("T-35.4: every technique is sound from any set of correct placements", SLOW, () => {
    const cellCount = geometry.size * geometry.size;
    assertProperty(
      fc.property(seedArb, fc.uniqueArray(fc.nat({ max: cellCount - 1 })), (seed, cells) => {
        const { puzzle, solution } = generatePuzzle({ seed, geometry });
        const context = graderContextOf(puzzle);
        const state = createGraderState(context, boardWith(solution, cells));
        expect(state.contradiction).toBe(false);
        expectCandidatesKeep(state, solution);
        for (const technique of TECHNIQUES) {
          for (const deduction of technique.find(context, state)) {
            expect(
              agrees(deduction, solution),
              `${technique.id} ${JSON.stringify(deduction)}`,
            ).toBe(true);
          }
        }
      }),
      { numRuns },
    );
  });

  it("T-35.5: levelToDeduce is 1 on singles and never rises with more correct cells", SLOW, () => {
    const cellCount = geometry.size * geometry.size;
    assertProperty(
      fc.property(
        seedArb,
        fc.uniqueArray(fc.nat({ max: cellCount - 1 }), { minLength: 1 }),
        fc.nat(),
        fc.nat(),
        (seed, cells, a, b) => {
          const { puzzle, solution } = generatePuzzle({ seed, geometry });
          const [target, ...rest] = cells;
          if (target === undefined) return;
          const given = puzzle.givens.some(({ cell }) => cell === target);
          if (given) return;
          const [few, many] = [a % (rest.length + 1), b % (rest.length + 1)].sort((x, y) => x - y);
          const levelFew = levelToDeduce(target, {
            puzzle,
            values: boardWith(solution, rest.slice(0, few)),
          });
          const manyValues = boardWith(solution, rest.slice(0, many));
          const levelMany = levelToDeduce(target, { puzzle, values: manyValues });
          expect(levelFew).toBeGreaterThanOrEqual(1);
          expect(levelFew).toBeLessThanOrEqual(UNRATED);
          expect(levelMany).toBeLessThanOrEqual(levelFew);

          // Si una técnica de nivel 1 coloca la celda, o ya tiene un solo candidato, vale 1.
          const context = graderContextOf(puzzle);
          const state = createGraderState(context, manyValues);
          const single =
            (at(state.candidates, target) & (at(state.candidates, target) - 1)) === 0 ||
            TECHNIQUES.filter((technique) => technique.level === 1).some((technique) =>
              technique.find(context, state).some((d) => d.kind === "place" && d.cell === target),
            );
          if (single) expect(levelMany).toBe(1);

          // Desde los números iniciales, `grade` llena el tablero con su nivel máximo, así que
          // ninguna celda necesita más, con o sin celdas correctas agregadas.
          const graded = grade(puzzle);
          if (graded.status === "solved") expect(levelFew).toBeLessThanOrEqual(graded.maxLevel);
        },
      ),
      { numRuns },
    );
  });
});

describe("grader on puzzles with any number of solutions (4x4)", () => {
  it("T-35.4: a deduction holds in every solution, and the grader never guesses", () => {
    assertProperty(
      fc.property(killerArb(GEOMETRY_4), fc.boolean(), ({ puzzle }, shifted) => {
        // Con todas las jaulas de 4 celdas, ninguna suma admite otro valor.
        const shiftable = puzzle.cages.some((cage) => cage.cells.length < puzzle.size);
        const target = shifted && shiftable ? shiftFirstSum(puzzle) : puzzle;
        const solutions = bruteForce4(target);
        const result = grade(target, { trace: true });
        const deductions = (result.trace ?? []).flatMap((step) => step.deductions);
        for (const solution of solutions) {
          for (const deduction of deductions) expect(agrees(deduction, solution)).toBe(true);
        }
        if (solutions.length === 0) expect(result.status).not.toBe("solved");
        if (solutions.length > 1) expect(result.status).toBe("exceedsTechniques");
        if (result.status === "solved") expect(solutions).toHaveLength(1);
      }),
      {
        numRuns: 300,
        regressions: [
          // `shiftFirstSum` lanzaba con jaulas iguales a las cajas (fallo de la prueba).
          { seed: 726692404, path: "25:0:1:6:0:2:2:1:1:1:1:1:1:1:1:2:1:1:2:2:2:3" },
        ],
      },
    );
  });

  it("an empty sudoku (cages equal to the boxes) exceeds the techniques", () => {
    const result = grade(boxCagesPuzzle());
    expect(result).toMatchObject({ status: "exceedsTechniques", maxLevel: UNRATED, unplaced: 16 });
  });
});

/** Máscaras de `count` dígitos distintos de 1 a `size` que suman `sum`, por enumeración directa. */
function subsets(size: number, count: number, sum: number): number[] {
  const masks: number[] = [];
  for (let mask = 0; mask < 1 << size; mask++) {
    const digits = Array.from({ length: size }, (_, i) => i + 1).filter(
      (d) => mask & (1 << (d - 1)),
    );
    if (digits.length === count && digits.reduce((a, b) => a + b, 0) === sum) masks.push(mask);
  }
  return masks;
}

function byCellAndDigit(a: Deduction, b: Deduction): number {
  return a.cell - b.cell || a.digit - b.digit || a.kind.localeCompare(b.kind);
}

describe("techniques against independent oracles", () => {
  const generated = generatePuzzle({ seed: 2026 });
  const { puzzle, solution } = generated;
  const technique = (id: string) => {
    const found = TECHNIQUES.find((t) => t.id === id);
    if (!found) throw new Error(`No technique ${id}`);
    return found;
  };

  it("levels: singles 1, cage combinations 2, innies and outies 3, in order", () => {
    expect(TECHNIQUES.map((t) => [t.id, t.level])).toEqual([
      ["nakedSingle", 1],
      ["hiddenSingle", 1],
      ["cageLastCell", 1],
      ["cageCombination", 2],
      ["cageForcedDigit", 2],
      ["innieOutie", 3],
    ]);
  });

  it("cageCombination on an empty board keeps the digits of the cage's combinations", () => {
    const context = graderContextOf(puzzle);
    const expected = puzzle.cages.flatMap((cage) => {
      let union = 0;
      for (const mask of subsets(9, cage.cells.length, cage.sum)) union |= mask;
      return cage.cells.flatMap((cell) =>
        Array.from({ length: 9 }, (_, i) => i + 1)
          .filter((digit) => (union & (1 << (digit - 1))) === 0)
          .map((digit): Deduction => ({ kind: "eliminate", cell, digit })),
      );
    });
    const found = technique("cageCombination").find(context, createGraderState(context));
    expect([...found].sort(byCellAndDigit)).toEqual(expected.sort(byCellAndDigit));
  });

  it("cageForcedDigit on an empty board removes required digits from cells that see the cage", () => {
    const context = graderContextOf(puzzle);
    const { peers } = layoutOf(puzzle);
    const expected = puzzle.cages.flatMap((cage) => {
      let required = 0x1ff;
      for (const mask of subsets(9, cage.cells.length, cage.sum)) required &= mask;
      const outside = Array.from({ length: 81 }, (_, cell) => cell).filter(
        (cell) =>
          !cage.cells.includes(cell) && cage.cells.every((c) => at(peers, c).includes(cell)),
      );
      return Array.from({ length: 9 }, (_, i) => i + 1)
        .filter((digit) => required & (1 << (digit - 1)))
        .flatMap((digit) => outside.map((cell): Deduction => ({ kind: "eliminate", cell, digit })));
    });
    const found = technique("cageForcedDigit").find(context, createGraderState(context));
    expect([...found].sort(byCellAndDigit)).toEqual(expected.sort(byCellAndDigit));
  });

  it("the sums of the innie and outie groups match the solution", () => {
    const context = graderContextOf(puzzle);
    expect(context.sumGroups.length).toBeGreaterThan(0);
    for (const group of context.sumGroups) {
      expect(group.cells.reduce((total, cell) => total + at(solution, cell), 0)).toBe(group.sum);
    }
  });

  it("singles: naked, hidden and last cage cell", () => {
    const context = graderContextOf(puzzle);
    // Naked single: la fila 0 llena salvo la celda 4.
    const naked = boardWith(solution, [0, 1, 2, 3, 5, 6, 7, 8]);
    expect(
      technique("nakedSingle").find(context, createGraderState(context, naked)),
    ).toContainEqual({ kind: "place", cell: 4, digit: at(solution, 4) });
    expect(levelToDeduce(4, { puzzle, values: naked })).toBe(1);

    // Última celda de una jaula: todas las demás colocadas.
    const cage = at(puzzle.cages, 0);
    const [last, ...others] = cage.cells;
    if (last === undefined) throw new Error("Empty cage");
    const lastCell = boardWith(solution, others);
    expect(
      technique("cageLastCell").find(context, createGraderState(context, lastCell)),
    ).toContainEqual({ kind: "place", cell: last, digit: at(solution, last) });
    expect(levelToDeduce(last, { puzzle, values: lastCell })).toBe(1);

    // Hidden single: con el dígito de la celda 0 colocado en las filas 1 y 2 y en las columnas 1
    // y 2, en la caja 0 solo cabe en la celda 0.
    const digit = at(solution, 0);
    const hiddenCells = solution.flatMap((d, cell) =>
      d === digit && cell !== 0 && (Math.floor(cell / 9) < 3 || cell % 9 < 3) ? [cell] : [],
    );
    const hidden = boardWith(solution, hiddenCells);
    const found = technique("hiddenSingle").find(context, createGraderState(context, hidden));
    expect(found).toContainEqual({ kind: "place", cell: 0, digit });
    expect(levelToDeduce(0, { puzzle, values: hidden })).toBe(1);
  });

  it("from an empty board without givens, no cell is a single", () => {
    expect(puzzle.givens).toEqual([]);
    // Una muestra de celdas: desde el tablero vacío, cada llamada tarda unos 15 ms.
    const empty = new Array<number>(81).fill(0);
    for (let cell = 0; cell < 81; cell += 5) {
      expect(levelToDeduce(cell, { puzzle, values: empty })).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("grader determinism and inputs", () => {
  it("is deterministic, with or without the memory of a previous call", () => {
    const { puzzle, solution } = generatePuzzle({ seed: 77 });
    const values = boardWith(solution, [3, 10, 20, 33, 47, 60, 71]);
    const first = {
      grade: grade(puzzle, { trace: true }),
      level: levelToDeduce(40, { puzzle, values }),
    };
    const again = {
      grade: grade(puzzle, { trace: true }),
      level: levelToDeduce(40, { puzzle, values }),
    };
    expect(again).toEqual(first);
    // Una copia es otro objeto, así que empieza sin memoria.
    const copy = structuredClone(puzzle);
    expect(grade(copy, { trace: true })).toEqual(first.grade);
    expect(levelToDeduce(40, { puzzle: structuredClone(puzzle), values })).toBe(first.level);
  });

  it("rejects invalid structures, cells and boards", () => {
    const { puzzle, solution } = generatePuzzle({ seed: 5 });
    const values = boardWith(solution, [0]);
    expect(() => grade({ ...puzzle, cages: puzzle.cages.slice(1) })).toThrow(RangeError);
    expect(() => levelToDeduce(81, { puzzle, values })).toThrow(RangeError);
    expect(() => levelToDeduce(1.5, { puzzle, values })).toThrow(RangeError);
    expect(() => levelToDeduce(0, { puzzle, values })).toThrow(RangeError);
    expect(() => levelToDeduce(1, { puzzle, values: values.slice(1) })).toThrow(RangeError);
    expect(() => levelToDeduce(1, { puzzle, values: values.map(() => 10) })).toThrow(RangeError);
  });

  it("a contradictory board gives UNRATED", () => {
    const { puzzle, solution } = generatePuzzle({ seed: 5 });
    // Dos celdas de la fila 0 con el mismo dígito.
    const values = boardWith(solution, [0]);
    values[1] = at(solution, 0);
    expect(levelToDeduce(2, { puzzle, values })).toBe(UNRATED);
  });
});
