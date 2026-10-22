// Oráculo de T-35.1: enumera todas las cuadrículas válidas de 4×4 con un backtracking ingenuo que no
// usa nada del motor, y se queda con las que el validador acepta para el puzzle.
import {
  validateSolution,
  type Geometry,
  type Grid,
  type KillerPuzzle,
} from "@sudoku-killer/engine";
import { GEOMETRY_4 } from "./grids.ts";

function allGrids({ size, boxRows, boxCols }: Geometry): Grid[] {
  const grids: Grid[] = [];
  const grid = new Array<number>(size * size).fill(0);
  const boxOf = (cell: number): number =>
    Math.floor(Math.floor(cell / size) / boxRows) * size + Math.floor((cell % size) / boxCols);

  const fits = (cell: number, digit: number): boolean => {
    for (let other = 0; other < cell; other++) {
      const sameRow = Math.floor(other / size) === Math.floor(cell / size);
      const sameCol = other % size === cell % size;
      if ((sameRow || sameCol || boxOf(other) === boxOf(cell)) && grid[other] === digit) {
        return false;
      }
    }
    return true;
  };
  const fill = (cell: number): void => {
    if (cell === grid.length) {
      grids.push([...grid]);
      return;
    }
    for (let digit = 1; digit <= size; digit++) {
      if (!fits(cell, digit)) continue;
      grid[cell] = digit;
      fill(cell + 1);
    }
    grid[cell] = 0;
  };
  fill(0);
  return grids;
}

let grids4: Grid[] | undefined;

/** Todas las soluciones de un puzzle 4×4. */
export function bruteForce4(puzzle: KillerPuzzle): Grid[] {
  if (puzzle.size !== GEOMETRY_4.size || puzzle.boxRows !== GEOMETRY_4.boxRows) {
    throw new RangeError("The brute force only covers 4x4 boards");
  }
  grids4 ??= allGrids(GEOMETRY_4);
  return grids4.filter((grid) => validateSolution(puzzle, grid).length === 0);
}

/** Claves ordenadas de un conjunto de cuadrículas, para compararlo sin depender del orden. */
export function gridKeys(grids: readonly Grid[]): string[] {
  return grids.map((grid) => grid.join(",")).sort();
}
