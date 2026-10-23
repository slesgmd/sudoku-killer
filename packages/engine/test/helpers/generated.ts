// Comprobaciones de un puzzle generado, independientes del generador: T-20.1 (estructura y unicidad
// según A y B, sin presupuesto) y T-20.2 (números iniciales y su motivo).
import { expect } from "vitest";
import {
  MAX_CAGE_SIZE,
  MIN_CAGE_SIZE,
  solveA,
  solveB,
  validateSolution,
  validateStructure,
  type GeneratedPuzzle,
} from "@sudoku-killer/engine";
import { at } from "../../src/model/at.ts";

/** T-20.1 y T-20.2 sobre un puzzle generado, con comprobaciones independientes del generador. */
export function expectSoundPuzzle(generated: GeneratedPuzzle, easyGivens = 0): void {
  const { puzzle, solution, givensReason, stats } = generated;
  expect(validateStructure(puzzle)).toEqual([]);
  expect(validateSolution(puzzle, solution)).toEqual([]);
  for (const cage of puzzle.cages) {
    expect(cage.cells.length).toBeGreaterThanOrEqual(MIN_CAGE_SIZE);
    expect(cage.cells.length).toBeLessThanOrEqual(Math.min(MAX_CAGE_SIZE, puzzle.size));
    const digits = cage.cells.map((cell) => at(solution, cell));
    expect(new Set(digits).size).toBe(digits.length);
    expect(digits.reduce((total, digit) => total + digit, 0)).toBe(cage.sum);
  }

  // Unicidad: los dos solvers, sin presupuesto, encuentran solo la solución generada.
  const a = solveA(puzzle);
  expect(a.count).toBe(1);
  expect(a.solutions).toEqual([solution]);
  const b = solveB(puzzle);
  expect(b.count).toBe(1);
  expect(b.solutions).toEqual([solution]);

  // T-20.2: los números iniciales y su motivo.
  for (const { cell, value } of puzzle.givens) expect(at(solution, cell)).toBe(value);
  expect(puzzle.givens).toHaveLength(stats.uniquenessGivens + easyGivens);
  if (givensReason === "none") expect(puzzle.givens).toEqual([]);
  else expect(puzzle.givens.length).toBeGreaterThan(0);
  expect(givensReason).toBe(
    easyGivens > 0 ? "easy" : stats.uniquenessGivens > 0 ? "uniqueness" : "none",
  );
  expect(stats.discarded).toBe(stats.candidates - 1);
}
