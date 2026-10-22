// Cuadrículas válidas para las pruebas, construidas con un patrón y transformaciones que preservan
// la validez (SPEC R-35). No se usa ninguna cuadrícula recordada: el validador comprueba todas.
import fc from "fast-check";
import type { Cage, Geometry, Grid, KillerPuzzle } from "@sudoku-killer/engine";
import { at } from "../../src/model/at.ts";

export const GEOMETRY_4: Geometry = { size: 4, boxRows: 2, boxCols: 2 };
export const GEOMETRY_6: Geometry = { size: 6, boxRows: 2, boxCols: 3 };
export const GEOMETRY_9: Geometry = { size: 9, boxRows: 3, boxCols: 3 };
export const GEOMETRIES = [GEOMETRY_4, GEOMETRY_6, GEOMETRY_9] as const;

/**
 * Patrón: la fila r se desplaza `(r mod boxRows) · boxCols + ⌊r / boxRows⌋`. Los desplazamientos
 * son distintos (columnas válidas) y dentro de una banda difieren en múltiplos de `boxCols`
 * (cajas válidas).
 */
export function patternGrid({ size, boxRows, boxCols }: Geometry): number[] {
  return Array.from({ length: size * size }, (_, cell) => {
    const row = Math.floor(cell / size);
    const col = cell % size;
    const shift = (row % boxRows) * boxCols + Math.floor(row / boxRows);
    return ((shift + col) % size) + 1;
  });
}

const permutation = (n: number): fc.Arbitrary<number[]> =>
  fc.shuffledSubarray(
    Array.from({ length: n }, (_, i) => i),
    { minLength: n, maxLength: n },
  );

/** Cuadrícula válida aleatoria: patrón + reetiquetado, permutaciones de bandas, filas y columnas. */
export function gridArb(geometry: Geometry): fc.Arbitrary<number[]> {
  const { size, boxRows, boxCols } = geometry;
  const bands = size / boxRows;
  const stacks = size / boxCols;
  return fc
    .record({
      digits: permutation(size),
      bandOrder: permutation(bands),
      rowOrders: fc.tuple(...Array.from({ length: bands }, () => permutation(boxRows))),
      stackOrder: permutation(stacks),
      colOrders: fc.tuple(...Array.from({ length: stacks }, () => permutation(boxCols))),
      transpose: boxRows === boxCols ? fc.boolean() : fc.constant(false),
    })
    .map(({ digits, bandOrder, rowOrders, stackOrder, colOrders, transpose }) => {
      const base = patternGrid(geometry);
      const sourceRow = (row: number): number =>
        at(bandOrder, Math.floor(row / boxRows)) * boxRows +
        at(at(rowOrders, Math.floor(row / boxRows)), row % boxRows);
      const sourceCol = (col: number): number =>
        at(stackOrder, Math.floor(col / boxCols)) * boxCols +
        at(at(colOrders, Math.floor(col / boxCols)), col % boxCols);
      return Array.from({ length: size * size }, (_, cell) => {
        let row = Math.floor(cell / size);
        let col = cell % size;
        if (transpose) [row, col] = [col, row];
        const digit = at(base, sourceRow(row) * size + sourceCol(col));
        return at(digits, digit - 1) + 1;
      });
    });
}

function neighbours(cell: number, size: number): number[] {
  const row = Math.floor(cell / size);
  const col = cell % size;
  const list: number[] = [];
  if (row > 0) list.push(cell - size);
  if (row < size - 1) list.push(cell + size);
  if (col > 0) list.push(cell - 1);
  if (col < size - 1) list.push(cell + 1);
  return list;
}

/**
 * Divide la cuadrícula en jaulas conectadas de 2 a 5 celdas sin dígitos repetidos, con decisiones
 * tomadas de `choices`. Devuelve null si queda una celda suelta que no se puede fusionar.
 */
export function partitionCages(
  geometry: Geometry,
  grid: Grid,
  choices: readonly number[],
): KillerPuzzle | null {
  const { size } = geometry;
  const cellCount = size * size;
  const maxCage = Math.min(5, size);
  let pointer = 0;
  const pick = (n: number): number => (choices[pointer++ % choices.length] ?? 0) % n;

  const owner = new Int32Array(cellCount).fill(-1);
  const groups: number[][] = [];
  for (let start = 0; start < cellCount; start++) {
    if (owner[start] !== -1) continue;
    const target = 2 + pick(maxCage - 1);
    const group = [start];
    owner[start] = groups.length;
    while (group.length < target) {
      const used = new Set(group.map((cell) => grid[cell]));
      const frontier = [...new Set(group.flatMap((cell) => neighbours(cell, size)))].filter(
        (cell) => owner[cell] === -1 && !used.has(grid[cell]),
      );
      if (frontier.length === 0) break;
      const next = at(frontier, pick(frontier.length));
      owner[next] = groups.length;
      group.push(next);
    }
    groups.push(group);
  }

  for (const [index, group] of groups.entries()) {
    const [cell] = group;
    if (group.length !== 1 || cell === undefined) continue;
    const target = neighbours(cell, size)
      .map((neighbour) => at(owner, neighbour))
      .find((other) => {
        const cells = at(groups, other);
        return cells.length < maxCage && !cells.some((c) => grid[c] === grid[cell]);
      });
    if (target === undefined) return null;
    at(groups, target).push(cell);
    owner[cell] = target;
    groups[index] = [];
  }

  const cages: Cage[] = groups
    .filter((group) => group.length > 0)
    .map((group, id) => ({
      id,
      cells: [...group].sort((a, b) => a - b),
      sum: group.reduce((total, cell) => total + at(grid, cell), 0),
    }));
  return { ...geometry, cages, givens: [] };
}

/** Puzzle killer válido aleatorio junto con su cuadrícula (una de sus soluciones). */
export function killerArb(
  geometry: Geometry,
): fc.Arbitrary<{ puzzle: KillerPuzzle; grid: number[] }> {
  return fc
    .tuple(gridArb(geometry), fc.array(fc.nat(), { minLength: 1, maxLength: 64 }))
    .map(([grid, choices]) => ({ puzzle: partitionCages(geometry, grid, choices), grid }))
    .filter((value): value is { puzzle: KillerPuzzle; grid: number[] } => value.puzzle !== null);
}

/** Cualquiera de las tres geometrías de prueba. */
export const anyKillerArb = fc.oneof(...GEOMETRIES.map((geometry) => killerArb(geometry)));
