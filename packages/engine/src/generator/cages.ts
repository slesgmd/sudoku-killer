// Pasos 2 y 5 del generador: partir la cuadrícula en jaulas y reajustarlas.
import type { Grid } from "../types.ts";
import { at } from "../model/at.ts";
import { digitBit } from "../model/mask.ts";
import { MAX_CAGE_SIZE, MIN_CAGE_SIZE, isConnected } from "../model/structure.ts";
import { shuffle, weightedIndex, type Rng } from "./rng.ts";

/** Pesos de los tamaños de jaula 2, 3, 4 y 5 al elegir el tamaño objetivo de cada una. */
export type CageSizeWeights = readonly [number, number, number, number];

/** Vecinas por lado, en orden fijo (arriba, abajo, izquierda, derecha). */
export function sideNeighbours(cell: number, size: number): number[] {
  const row = Math.floor(cell / size);
  const col = cell % size;
  const list: number[] = [];
  if (row > 0) list.push(cell - size);
  if (row < size - 1) list.push(cell + size);
  if (col > 0) list.push(cell - 1);
  if (col < size - 1) list.push(cell + 1);
  return list;
}

function maxCage(size: number): number {
  return Math.min(MAX_CAGE_SIZE, size);
}

function digitsMask(grid: Grid, cells: readonly number[]): number {
  return cells.reduce((mask, cell) => mask | digitBit(at(grid, cell)), 0);
}

/** Sin dígitos repetidos según la cuadrícula. */
function hasDistinctDigits(grid: Grid, cells: readonly number[]): boolean {
  return new Set(cells.map((cell) => at(grid, cell))).size === cells.length;
}

/**
 * Hace crecer desde `start` una región conectada de hasta `target` celdas dentro de `allowed`,
 * sin repetir dígitos: en cada paso agrega una vecina al azar. Si se queda sin vecinas, devuelve
 * la región más chica a la que llegó.
 */
function grow(
  grid: Grid,
  size: number,
  rng: Rng,
  start: number,
  target: number,
  allowed: (cell: number) => boolean,
): number[] {
  const region = [start];
  const inRegion = new Set(region);
  let used = digitBit(at(grid, start));
  while (region.length < target) {
    const frontier = [...new Set(region.flatMap((cell) => sideNeighbours(cell, size)))].filter(
      (cell) => !inRegion.has(cell) && allowed(cell) && (used & digitBit(at(grid, cell))) === 0,
    );
    if (frontier.length === 0) break;
    const next = at(frontier, rng.int(frontier.length));
    region.push(next);
    inRegion.add(next);
    used |= digitBit(at(grid, next));
  }
  return region;
}

/**
 * Parte la cuadrícula en jaulas conectadas de 2 a 5 celdas (y como mucho `size`) sin dígitos
 * repetidos. Recorre las celdas en orden aleatorio; cada celda libre empieza una jaula con un
 * tamaño objetivo elegido con `weights`, que crece mientras haya vecinas libres. Una celda que
 * queda sola se une a una jaula vecina con lugar y sin su dígito. Devuelve null si no hay ninguna:
 * el llamador vuelve a intentarlo con el mismo `rng`. Cada jaula sale con sus celdas ordenadas.
 */
export function partitionCages(
  grid: Grid,
  size: number,
  rng: Rng,
  weights: CageSizeWeights,
): number[][] | null {
  const cellCount = size * size;
  const largest = maxCage(size);
  const sizeWeights = weights.slice(0, largest - MIN_CAGE_SIZE + 1);
  const owner = new Int32Array(cellCount).fill(-1);
  const cages: number[][] = [];

  const starts = shuffle(
    rng,
    Array.from({ length: cellCount }, (_, cell) => cell),
  );
  for (const start of starts) {
    if (at(owner, start) !== -1) continue;
    const target = MIN_CAGE_SIZE + weightedIndex(rng, sizeWeights);
    const cage = grow(grid, size, rng, start, target, (cell) => at(owner, cell) === -1);
    for (const cell of cage) owner[cell] = cages.length;
    cages.push(cage);
  }

  for (const [index, cage] of cages.entries()) {
    const [cell] = cage;
    if (cage.length !== 1 || cell === undefined) continue;
    const digit = digitBit(at(grid, cell));
    const targets = [...new Set(sideNeighbours(cell, size).map((n) => at(owner, n)))].filter(
      (other) => {
        const cells = at(cages, other);
        // Otra celda suelta también sirve: juntas forman una jaula de 2.
        return cells.length < largest && (digitsMask(grid, cells) & digit) === 0;
      },
    );
    if (targets.length === 0) return null;
    const target = at(targets, rng.int(targets.length));
    at(cages, target).push(cell);
    owner[cell] = target;
    cages[index] = [];
  }

  return cages.filter((cage) => cage.length > 0).map((cage) => cage.sort((a, b) => a - b));
}

/**
 * Vuelve a cortar `cells` (una jaula, o la unión de dos vecinas) en dos jaulas conectadas de 2 a 5
 * celdas sin dígitos repetidos. Prueba hasta `attempts` cortes al azar y descarta los que repiten
 * una de las jaulas de `current`. Devuelve las dos jaulas, con sus celdas ordenadas, o null.
 */
export function recut(
  grid: Grid,
  size: number,
  rng: Rng,
  cells: readonly number[],
  current: readonly (readonly number[])[],
  attempts: number,
): [number[], number[]] | null {
  const largest = maxCage(size);
  const total = cells.length;
  const minPart = Math.max(MIN_CAGE_SIZE, total - largest);
  const maxPart = Math.min(largest, total - MIN_CAGE_SIZE);
  if (minPart > maxPart) return null;
  const members = new Set(cells);
  const key = (list: readonly number[]): string => [...list].sort((a, b) => a - b).join(",");
  const currentKeys = new Set(current.map(key));

  for (let attempt = 0; attempt < attempts; attempt++) {
    const start = at(cells, rng.int(total));
    const target = minPart + rng.int(maxPart - minPart + 1);
    const part = grow(grid, size, rng, start, target, (cell) => members.has(cell));
    if (part.length !== target) continue;
    const inPart = new Set(part);
    const rest = cells.filter((cell) => !inPart.has(cell));
    if (!isConnected(rest, size) || !hasDistinctDigits(grid, rest)) continue;
    if (currentKeys.has(key(part)) || currentKeys.has(key(rest))) continue;
    return [part.sort((a, b) => a - b), rest.sort((a, b) => a - b)];
  }
  return null;
}
