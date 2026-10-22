// T-35.3: estructura del puzzle, validación de soluciones, checkPlacement e isEvidentMistake.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  checkPlacement,
  isEvidentMistake,
  validateSolution,
  validateStructure,
  type Cage,
  type KillerPuzzle,
  type StructureIssue,
} from "@sudoku-killer/engine";
import { GEOMETRIES, GEOMETRY_4, GEOMETRY_9, anyKillerArb, patternGrid } from "./helpers/grids.ts";

/** 4x4 con jaulas horizontales de 2 celdas; las sumas salen de la cuadrícula del patrón. */
function basePuzzle(): { puzzle: KillerPuzzle; grid: number[] } {
  const grid = patternGrid(GEOMETRY_4);
  const cages: Cage[] = Array.from({ length: 8 }, (_, id) => ({
    id,
    cells: [2 * id, 2 * id + 1],
    sum: grid[2 * id]! + grid[2 * id + 1]!,
  }));
  return { puzzle: { ...GEOMETRY_4, cages, givens: [] }, grid };
}

const codes = (issues: readonly StructureIssue[]): string[] =>
  [...new Set(issues.map((issue) => issue.code))].sort();

describe("T-35.3 validateStructure", () => {
  it("accepts random valid puzzles of every test geometry", () => {
    fc.assert(
      fc.property(anyKillerArb, ({ puzzle }) => {
        expect(validateStructure(puzzle)).toEqual([]);
      }),
      { numRuns: 60 },
    );
  });

  it("the pattern grid is a valid sudoku for every test geometry", () => {
    for (const geometry of GEOMETRIES) {
      const grid = patternGrid(geometry);
      const rowsOnly: KillerPuzzle = { ...geometry, cages: [], givens: [] };
      expect(validateSolution(rowsOnly, grid)).toEqual([]);
    }
  });

  const mutations: [string, (p: KillerPuzzle) => KillerPuzzle][] = [
    ["geometry", (p) => ({ ...p, boxRows: 1 })],
    ["cage-id-duplicate", (p) => ({ ...p, cages: p.cages.map((c) => ({ ...c, id: 0 })) })],
    [
      "cage-size",
      (p) => ({
        ...p,
        cages: [
          { id: 100, cells: [0], sum: 1 },
          { id: 101, cells: [1], sum: 2 },
          ...p.cages.slice(1),
        ],
      }),
    ],
    [
      "cage-cell-out-of-range",
      (p) => ({ ...p, cages: [{ ...p.cages[0]!, cells: [0, 1, 16] }, ...p.cages.slice(1)] }),
    ],
    [
      "cage-overlap",
      (p) => ({
        ...p,
        cages: [p.cages[0]!, { ...p.cages[1]!, cells: [1, 2, 3] }, ...p.cages.slice(2)],
      }),
    ],
    [
      "cage-sum-unreachable",
      (p) => ({ ...p, cages: [{ ...p.cages[0]!, sum: 2 }, ...p.cages.slice(1)] }),
    ],
    ["cell-uncovered", (p) => ({ ...p, cages: p.cages.slice(1) })],
    ["given-invalid", (p) => ({ ...p, givens: [{ cell: 0, value: 5 }] })],
    [
      "given-duplicate-cell",
      (p) => ({
        ...p,
        givens: [
          { cell: 0, value: 1 },
          { cell: 0, value: 1 },
        ],
      }),
    ],
    [
      "given-conflict",
      (p) => ({
        ...p,
        givens: [
          { cell: 0, value: 1 },
          { cell: 3, value: 1 },
        ],
      }),
    ],
  ];

  it.each(mutations)("detects %s", (code, mutate) => {
    const { puzzle } = basePuzzle();
    expect(validateStructure(puzzle)).toEqual([]);
    expect(codes(validateStructure(mutate(puzzle)))).toContain(code);
  });

  it("detects disconnected and oversized cages", () => {
    const grid = patternGrid(GEOMETRY_9);
    const cages: Cage[] = [
      { id: 0, cells: [0, 2], sum: grid[0]! + grid[2]! },
      { id: 1, cells: [3, 4, 5, 6, 7, 8], sum: 39 },
    ];
    const found = codes(validateStructure({ ...GEOMETRY_9, cages, givens: [] }));
    expect(found).toContain("cage-disconnected");
    expect(found).toContain("cage-size");
  });
});

describe("T-35.3 validateSolution", () => {
  it("accepts the grid a random puzzle was built from", () => {
    fc.assert(
      fc.property(anyKillerArb, ({ puzzle, grid }) => {
        expect(validateSolution(puzzle, grid)).toEqual([]);
      }),
      { numRuns: 60 },
    );
  });

  it("rejects a grid with one changed cell", () => {
    fc.assert(
      fc.property(anyKillerArb, fc.nat(), fc.nat(), ({ puzzle, grid }, at, delta) => {
        const cell = at % grid.length;
        const changed = [...grid];
        changed[cell] = ((grid[cell]! - 1 + 1 + (delta % (puzzle.size - 1))) % puzzle.size) + 1;
        expect(validateSolution(puzzle, changed)).not.toEqual([]);
      }),
      { numRuns: 60 },
    );
  });

  it("reports wrong sums, givens, digits and length", () => {
    const { puzzle, grid } = basePuzzle();
    const wrongSum = {
      ...puzzle,
      cages: [{ ...puzzle.cages[0]!, sum: 4 }, ...puzzle.cages.slice(1)],
    };
    expect(validateSolution(wrongSum, grid)).toEqual([{ code: "cage-sum", cageId: 0 }]);
    const wrongGiven = { ...puzzle, givens: [{ cell: 0, value: grid[1]! }] };
    expect(validateSolution(wrongGiven, grid)).toEqual([{ code: "given", cell: 0 }]);
    expect(validateSolution(puzzle, grid.slice(1))).toEqual([{ code: "length" }]);
    expect(validateSolution(puzzle, [0, ...grid.slice(1)])).toEqual([{ code: "digit", cell: 0 }]);
  });

  it("reports a digit repeated inside a cage that spans two rows", () => {
    // Columna 0 del 4x4 en una jaula de 2 celdas con el mismo dígito: no es una cuadrícula
    // válida, pero la jaula se comprueba aparte de filas y columnas.
    const { puzzle, grid } = basePuzzle();
    const repeated = [...grid];
    repeated[4] = grid[0]!;
    const issues = validateSolution(
      { ...puzzle, cages: [{ id: 9, cells: [0, 4], sum: 2 * grid[0]! }] },
      repeated,
    );
    expect(issues).toContainEqual({ code: "cage-repeat", cageId: 9 });
  });
});

describe("T-35.3 checkPlacement and isEvidentMistake", () => {
  it("checkPlacement is correct only with the solution digit", () => {
    const { grid } = basePuzzle();
    for (let cell = 0; cell < grid.length; cell++) {
      for (let digit = 1; digit <= 4; digit++) {
        expect(checkPlacement(grid, cell, digit)).toBe(
          grid[cell] === digit ? "correct" : "mistake",
        );
      }
    }
    expect(() => checkPlacement(grid, 16, 1)).toThrow(RangeError);
  });

  it("isEvidentMistake detects a repeated locked digit in a row, column, box or cage (R-28)", () => {
    // Jaula en L de 9x9: las celdas 2 (f0 c2) y 12 (f1 c3) solo comparten la jaula.
    const puzzle: KillerPuzzle = {
      ...GEOMETRY_9,
      cages: [{ id: 0, cells: [2, 3, 12], sum: 12 }],
      givens: [],
    };
    const locked = new Array<number>(81).fill(0);
    locked[2] = 7;
    expect(isEvidentMistake(puzzle, locked, 12, 7)).toBe(true); // jaula
    expect(isEvidentMistake(puzzle, locked, 8, 7)).toBe(true); // fila
    expect(isEvidentMistake(puzzle, locked, 74, 7)).toBe(true); // columna
    expect(isEvidentMistake(puzzle, locked, 19, 7)).toBe(true); // caja
    expect(isEvidentMistake(puzzle, locked, 12, 6)).toBe(false); // otro dígito
    expect(isEvidentMistake(puzzle, locked, 40, 7)).toBe(false); // no es par
  });
});
