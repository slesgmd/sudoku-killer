import type { KillerPuzzle } from "../types.ts";
import { cageIndexByCell, layoutOf, peersWithCage, type Layout } from "../model/geometry.ts";
import { digitBit, fullMask } from "../model/mask.ts";
import { validateStructure } from "../model/structure.ts";
import { cageCombinations } from "./combos.ts";

/** Grupos de suma de hasta este tamaño se filtran por combinaciones si sus celdas son pares. */
const MAX_EXACT_GROUP = 5;

/**
 * Celdas con suma conocida: una jaula, o los innies o los outies de una región (regla del 45).
 * `combos` existe si las celdas son pares entre sí y caben en el filtro exacto (siempre en una
 * jaula); si no, se usan cotas de suma.
 */
export interface Group {
  readonly cells: Int16Array;
  readonly sum: number;
  readonly combos: readonly number[] | null;
}

/** Cruce de una caja con una fila o una columna, para los locked candidates. */
export interface Segment {
  readonly shared: Int16Array;
  readonly boxRest: Int16Array;
  readonly lineRest: Int16Array;
}

/** Datos de un puzzle precalculados para el solver A. */
export interface Context {
  readonly size: number;
  readonly cellCount: number;
  readonly full: number;
  /** Filas, columnas y cajas, en ese orden: cada una tiene todos los dígitos. */
  readonly units: readonly Int16Array[];
  readonly rowOf: Uint8Array;
  readonly colOf: Uint8Array;
  readonly boxOf: Uint8Array;
  readonly segments: readonly Segment[];
  /** Pares de cada celda: fila, columna, caja y jaula. */
  readonly peers: readonly Int16Array[];
  /** Primero las jaulas, en el orden del puzzle; después los innies y outies. */
  readonly groups: readonly Group[];
  /** Grupos que contienen cada celda. */
  readonly groupsOf: readonly Int16Array[];
  /** Candidatos de partida: todos los dígitos, o el número inicial. */
  readonly initial: Uint16Array;
  /** Memoria de trabajo: cola de singles (cada celda entra como mucho una vez por propagación). */
  readonly queue: Int16Array;
  readonly work: { queued: number };
  /** Pesos de dom/wdeg: crecen con los fallos en que participa cada celda. */
  readonly weights: Float64Array;
  /** Memoria de trabajo del filtro exacto. */
  readonly support: Uint16Array;
  readonly path: Uint16Array;
}

/**
 * Regiones con suma conocida, cada una unión de `k` unidades completas que suma
 * `k · size · (size + 1) / 2`: cada caja, cada par de cajas vecinas, cada bloque de 2 × 2 cajas y
 * cada unión de 1 a size − 1 filas o columnas consecutivas.
 */
function regions(layout: Layout): (readonly number[])[] {
  const { size, boxRows, boxCols } = layout.geometry;
  const across = size / boxCols;
  const down = size / boxRows;
  const box = (row: number, col: number): readonly number[] =>
    row < down && col < across ? (layout.boxes[row * across + col] ?? []) : [];

  const list: (readonly number[])[] = [];
  for (let row = 0; row < down; row++) {
    for (let col = 0; col < across; col++) {
      const here = box(row, col);
      const right = box(row, col + 1);
      const below = box(row + 1, col);
      list.push(here);
      if (right.length > 0) list.push([...here, ...right]);
      if (below.length > 0) list.push([...here, ...below]);
      if (right.length > 0 && below.length > 0) {
        list.push([...here, ...right, ...below, ...box(row + 1, col + 1)]);
      }
    }
  }
  for (const lines of [layout.rows, layout.cols]) {
    for (let count = 1; count < size; count++) {
      for (let first = 0; first + count <= size; first++) {
        list.push(lines.slice(first, first + count).flat());
      }
    }
  }
  return list;
}

function buildSegments(layout: Layout): Segment[] {
  const segments: Segment[] = [];
  for (const box of layout.boxes) {
    const inBox = new Set(box);
    for (const lines of [layout.rows, layout.cols]) {
      for (const line of lines) {
        const shared = line.filter((cell) => inBox.has(cell));
        if (shared.length === 0) continue;
        segments.push({
          shared: Int16Array.from(shared),
          boxRest: Int16Array.from(box.filter((cell) => !shared.includes(cell))),
          lineRest: Int16Array.from(line.filter((cell) => !inBox.has(cell))),
        });
      }
    }
  }
  return segments;
}

/** Innies y outies de cada región, sin repetir. */
function buildSumGroups(
  puzzle: KillerPuzzle,
  layout: Layout,
  cageOf: Int16Array,
  peers: readonly Int16Array[],
): Group[] {
  const { size } = puzzle;
  const unitSum = (size * (size + 1)) / 2;
  const groups = new Map<string, Group>();

  const add = (cells: number[], sum: number): void => {
    if (cells.length === 0 || cells.length > size) return;
    cells.sort((a, b) => a - b);
    const key = `${cells.join(",")}=${String(sum)}`;
    if (groups.has(key)) return;
    const distinct = cells.every((cell, i) =>
      cells.slice(i + 1).every((other) => peers[cell]?.includes(other)),
    );
    const combos =
      distinct && cells.length <= MAX_EXACT_GROUP
        ? cageCombinations(size, cells.length, sum)
        : null;
    groups.set(key, { cells: Int16Array.from(cells), sum, combos });
  };

  for (const region of regions(layout)) {
    const inside = new Set(region);
    const partial = new Set<number>();
    let fullSum = 0;
    const counted = new Set<number>();
    for (const cell of region) {
      const cage = cageOf[cell] ?? -1;
      if (counted.has(cage)) continue;
      counted.add(cage);
      const { cells, sum } = puzzle.cages[cage] ?? { cells: [], sum: 0 };
      if (cells.every((other) => inside.has(other))) fullSum += sum;
      else partial.add(cage);
    }
    const regionSum = (region.length / size) * unitSum;
    const partialCells = [...partial].flatMap((cage) => puzzle.cages[cage]?.cells ?? []);
    const partialSum = [...partial].reduce(
      (total, cage) => total + (puzzle.cages[cage]?.sum ?? 0),
      0,
    );
    const innies = partialCells.filter((cell) => inside.has(cell));
    const outies = partialCells.filter((cell) => !inside.has(cell));
    add(innies, regionSum - fullSum);
    add(outies, partialSum - (regionSum - fullSum));
  }
  return [...groups.values()];
}

/** Precalcula el contexto. Exige una estructura válida (`validateStructure`). */
export function buildContext(puzzle: KillerPuzzle): Context {
  const issues = validateStructure(puzzle);
  if (issues.length > 0) {
    const codes = [...new Set(issues.map((issue) => issue.code))].join(", ");
    throw new RangeError(`Invalid puzzle structure: ${codes}`);
  }
  const layout = layoutOf(puzzle);
  const { size } = puzzle;
  const { cellCount } = layout;
  const cageOf = cageIndexByCell(cellCount, puzzle.cages);
  const full = fullMask(size);
  const initial = new Uint16Array(cellCount).fill(full);
  for (const { cell, value } of puzzle.givens) initial[cell] = digitBit(value);
  const peers = Array.from({ length: cellCount }, (_, cell) =>
    Int16Array.from(peersWithCage(layout, puzzle.cages[cageOf[cell]!], cell)),
  );
  const maxCage = Math.max(MAX_EXACT_GROUP, ...puzzle.cages.map((cage) => cage.cells.length));
  const groups: Group[] = [
    ...puzzle.cages.map((cage) => ({
      cells: Int16Array.from(cage.cells),
      sum: cage.sum,
      combos: cageCombinations(size, cage.cells.length, cage.sum),
    })),
    ...buildSumGroups(puzzle, layout, cageOf, peers),
  ];
  const groupsOf = Array.from({ length: cellCount }, () => [] as number[]);
  groups.forEach((group, index) => {
    for (const cell of group.cells) groupsOf[cell]?.push(index);
  });

  return {
    size,
    cellCount,
    full,
    units: [...layout.rows, ...layout.cols, ...layout.boxes].map((unit) => Int16Array.from(unit)),
    rowOf: layout.rowOf,
    colOf: layout.colOf,
    boxOf: layout.boxOf,
    segments: buildSegments(layout),
    peers,
    groups,
    groupsOf: groupsOf.map((list) => Int16Array.from(list)),
    initial,
    queue: new Int16Array(cellCount),
    work: { queued: 0 },
    weights: new Float64Array(cellCount).fill(1),
    support: new Uint16Array(maxCage),
    path: new Uint16Array(maxCage),
  };
}
