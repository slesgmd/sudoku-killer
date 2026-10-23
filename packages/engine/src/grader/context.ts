// Datos de un puzzle precalculados para el calificador: unidades, jaulas, pares y grupos de la regla
// del 45. Se calculan una vez por puzzle (memoizado por objeto), porque `levelToDeduce` se llama en
// cada jugada correcta.
import type { KillerPuzzle } from "../types.ts";
import { at } from "../model/at.ts";
import { layoutOf } from "../model/geometry.ts";
import { fullMask } from "../model/mask.ts";
import { validateStructure } from "../model/structure.ts";
import type { SumSupport } from "./sum-group.ts";

/** Celdas con suma conocida: los innies o los outies de una región. */
export interface SumGroup {
  readonly cells: readonly number[];
  readonly sum: number;
}

export interface GraderContext {
  readonly puzzle: KillerPuzzle;
  readonly size: number;
  readonly cellCount: number;
  readonly full: number;
  /** Filas, columnas y cajas, en ese orden: cada una tiene todos los dígitos. */
  readonly units: readonly (readonly number[])[];
  readonly cages: readonly { readonly cells: readonly number[]; readonly sum: number }[];
  /** Índice de la jaula de cada celda. */
  readonly cageOf: readonly number[];
  /** Pares de cada celda: fila, columna, caja y jaula. */
  readonly peers: readonly (readonly number[])[];
  /** `isPeer[a * cellCount + b]` es 1 si `a` y `b` son pares (no pueden repetir dígito). */
  readonly isPeer: Uint8Array;
  /** Innies y outies de cada región (regla del 45), sin repetir conjuntos de celdas. */
  readonly sumGroups: readonly SumGroup[];
  /**
   * Memoria de `cachedSumSupport`: el último resultado de cada jaula (claves 0 a `cages.length − 1`)
   * y de cada grupo (a continuación), con las máscaras con que se calculó.
   */
  readonly supportCache: (
    { readonly masks: readonly number[]; readonly result: SumSupport } | undefined
  )[];
  /**
   * Memoria de las combinaciones de unidad (nivel 5), por índice de `units`: el último soporte, con
   * las máscaras de la unidad y de las celdas de fuera de sus jaulas con que se calculó.
   */
  readonly unitCache: (
    { readonly masks: readonly number[]; readonly support: number[] } | undefined
  )[];
}

const contexts = new WeakMap<KillerPuzzle, GraderContext>();

/** Contexto del calificador para el puzzle (memoizado). Lanza `RangeError` si la estructura no es válida. */
export function graderContextOf(puzzle: KillerPuzzle): GraderContext {
  const cached = contexts.get(puzzle);
  if (cached) return cached;
  const issues = validateStructure(puzzle);
  if (issues.length > 0) {
    const codes = [...new Set(issues.map((issue) => issue.code))].join(", ");
    throw new RangeError(`Invalid puzzle structure: ${codes}`);
  }
  const context = buildContext(puzzle);
  contexts.set(puzzle, context);
  return context;
}

function buildContext(puzzle: KillerPuzzle): GraderContext {
  const layout = layoutOf(puzzle);
  const { size } = puzzle;
  const { cellCount } = layout;
  const units = [...layout.rows, ...layout.cols, ...layout.boxes];
  const cages = puzzle.cages.map(({ cells, sum }) => ({ cells: [...cells], sum }));

  const cageOf = new Array<number>(cellCount).fill(-1);
  cages.forEach((cage, index) => {
    for (const cell of cage.cells) cageOf[cell] = index;
  });

  const isPeer = new Uint8Array(cellCount * cellCount);
  const peers = Array.from({ length: cellCount }, (_, cell) => {
    const set = new Set(at(layout.peers, cell));
    for (const other of at(cages, at(cageOf, cell)).cells) if (other !== cell) set.add(other);
    const list = [...set].sort((a, b) => a - b);
    for (const other of list) isPeer[cell * cellCount + other] = 1;
    return list;
  });

  const sumGroups = buildSumGroups(size, layout.rows, layout.cols, layout.boxes, cages, cageOf);
  return {
    puzzle,
    size,
    cellCount,
    full: fullMask(size),
    units,
    cages,
    cageOf,
    peers,
    isPeer,
    sumGroups,
    supportCache: new Array<undefined>(cages.length + sumGroups.length).fill(undefined),
    unitCache: new Array<undefined>(units.length).fill(undefined),
  };
}

/**
 * Regiones de la regla del 45: cada fila, columna y caja, y cada unión de 2 a `size − 1` filas o
 * columnas consecutivas. Una región de `k` unidades suma `k · size · (size + 1) / 2`. Restando las
 * jaulas que caben enteras, las celdas de la región en jaulas que sobresalen (innies) tienen suma
 * conocida, y también las celdas de esas jaulas que quedan fuera (outies).
 */
function buildSumGroups(
  size: number,
  rows: readonly (readonly number[])[],
  cols: readonly (readonly number[])[],
  boxes: readonly (readonly number[])[],
  cages: GraderContext["cages"],
  cageOf: readonly number[],
): SumGroup[] {
  const regions: { cells: number[]; units: number }[] = [];
  for (const unit of [...rows, ...cols, ...boxes]) regions.push({ cells: [...unit], units: 1 });
  for (const lines of [rows, cols]) {
    for (let count = 2; count < size; count++) {
      for (let first = 0; first + count <= size; first++) {
        regions.push({ cells: lines.slice(first, first + count).flat(), units: count });
      }
    }
  }

  const unitSum = (size * (size + 1)) / 2;
  const groups: SumGroup[] = [];
  const seen = new Set<string>();
  const add = (cells: number[], sum: number): void => {
    if (cells.length === 0) return;
    cells.sort((a, b) => a - b);
    const key = cells.join(",");
    if (seen.has(key)) return;
    seen.add(key);
    groups.push({ cells, sum });
  };

  for (const region of regions) {
    const inside = new Set(region.cells);
    const insideCount = new Map<number, number>();
    for (const cell of region.cells) {
      const cage = at(cageOf, cell);
      insideCount.set(cage, (insideCount.get(cage) ?? 0) + 1);
    }
    let innieSum = region.units * unitSum;
    let partialSum = 0;
    const innies: number[] = [];
    const outies: number[] = [];
    for (const [index, count] of insideCount) {
      const cage = at(cages, index);
      if (count === cage.cells.length) {
        innieSum -= cage.sum;
        continue;
      }
      partialSum += cage.sum;
      for (const cell of cage.cells) (inside.has(cell) ? innies : outies).push(cell);
    }
    add(innies, innieSum);
    add(outies, partialSum - innieSum);
  }
  return groups;
}
