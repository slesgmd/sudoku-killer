import type { KillerPuzzle } from "../types.ts";

/**
 * Formulación del puzzle como cobertura exacta. Cada opción llena una jaula entera con una
 * permutación de dígitos distintos que da su suma y respeta los números iniciales. Ítems, todos
 * primarios (se cubren exactamente una vez):
 * - cada celda;
 * - cada (fila, dígito), (columna, dígito) y (caja, dígito).
 */
export interface ExactCover {
  readonly itemCount: number;
  /** Ítems de cada opción, de 0 a `itemCount − 1`. */
  readonly options: readonly (readonly number[])[];
  /** Celdas de cada opción y, en el mismo orden, sus dígitos. */
  readonly cells: readonly (readonly number[])[];
  readonly digits: readonly (readonly number[])[];
}

const MAX_SIZE = 16;
const MIN_CAGE = 2;
const MAX_CAGE = 5;

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/**
 * Comprueba lo que la matriz necesita para estar bien definida: geometría, jaulas de 2 a 5 celdas
 * que parten el tablero y números iniciales en rango sin celdas repetidas. B no puede usar
 * `validateStructure` (R-35), así que no repite el resto (conexión, ids, sumas alcanzables): con
 * una suma inalcanzable, la jaula no tiene opciones y el resultado es 0 soluciones.
 */
function checkInput(puzzle: KillerPuzzle): void {
  const { size, boxRows, boxCols, cages, givens } = puzzle;
  if (
    !isPositiveInteger(boxRows) ||
    !isPositiveInteger(boxCols) ||
    size !== boxRows * boxCols ||
    size > MAX_SIZE
  ) {
    throw new RangeError(
      `Invalid geometry ${String(size)} (${String(boxRows)}x${String(boxCols)})`,
    );
  }
  const cellCount = size * size;
  const covered = new Uint8Array(cellCount);
  for (const cage of cages) {
    if (cage.cells.length < MIN_CAGE || cage.cells.length > Math.min(MAX_CAGE, size)) {
      throw new RangeError(`Cage ${String(cage.id)} has ${String(cage.cells.length)} cells`);
    }
    if (!Number.isInteger(cage.sum)) throw new RangeError(`Cage ${String(cage.id)} has no sum`);
    for (const cell of cage.cells) {
      if (!Number.isInteger(cell) || cell < 0 || cell >= cellCount || covered[cell] === 1) {
        throw new RangeError(`Cell ${String(cell)} is out of range or in two cages`);
      }
      covered[cell] = 1;
    }
  }
  if (covered.includes(0)) throw new RangeError("The cages do not cover the board");
  const seen = new Uint8Array(cellCount);
  for (const { cell, value } of givens) {
    if (!Number.isInteger(cell) || cell < 0 || cell >= cellCount || seen[cell] === 1) {
      throw new RangeError(`Given cell ${String(cell)} is out of range or repeated`);
    }
    if (!Number.isInteger(value) || value < 1 || value > size) {
      throw new RangeError(`Given value ${String(value)} is out of range`);
    }
    seen[cell] = 1;
  }
}

/**
 * Construye la matriz de cobertura exacta. Lanza `RangeError` si la entrada no la define. Con
 * `blockPeers`, una poda propia de B, se descartan también las opciones que repiten un número
 * inicial de su fila, columna o caja; sin ella, la matriz es la de la formulación pura.
 */
export function buildExactCover(puzzle: KillerPuzzle, blockPeers = true): ExactCover {
  checkInput(puzzle);
  const { size, boxRows, boxCols } = puzzle;
  const cellCount = size * size;
  const rowOf = (cell: number): number => Math.floor(cell / size);
  const colOf = (cell: number): number => cell % size;
  const boxOf = (cell: number): number =>
    Math.floor(rowOf(cell) / boxRows) * boxRows + Math.floor(colOf(cell) / boxCols);

  // Dígito fijo de cada celda (0 si no tiene) y dígitos prohibidos por un número inicial de su
  // fila, columna o caja. Es solo una poda: la cobertura exacta ya excluiría esas opciones.
  const fixed = new Uint8Array(cellCount);
  const blocked = new Uint16Array(cellCount);
  for (const { cell, value } of puzzle.givens) fixed[cell] = value;
  for (const { cell: given, value } of blockPeers ? puzzle.givens : []) {
    for (let cell = 0; cell < cellCount; cell++) {
      if (
        cell !== given &&
        (rowOf(cell) === rowOf(given) ||
          colOf(cell) === colOf(given) ||
          boxOf(cell) === boxOf(given))
      ) {
        blocked[cell]! |= 1 << (value - 1);
      }
    }
  }

  const options: number[][] = [];
  const cells: (readonly number[])[] = [];
  const digits: number[][] = [];
  const itemsOf = (cell: number, digit: number): number[] => [
    cell,
    cellCount + rowOf(cell) * size + digit - 1,
    2 * cellCount + colOf(cell) * size + digit - 1,
    3 * cellCount + boxOf(cell) * size + digit - 1,
  ];

  for (const cage of puzzle.cages) {
    const k = cage.cells.length;
    const chosen = new Array<number>(k).fill(0);

    // Suma mínima y máxima de `count` dígitos distintos de 1..size que no están en `used`.
    const bounds = (count: number, used: number): [number, number] => {
      let min = 0;
      let max = 0;
      for (let d = 1, left = count; d <= size && left > 0; d++) {
        if ((used & (1 << (d - 1))) === 0) {
          min += d;
          left--;
        }
      }
      for (let d = size, left = count; d >= 1 && left > 0; d--) {
        if ((used & (1 << (d - 1))) === 0) {
          max += d;
          left--;
        }
      }
      return [min, max];
    };

    // Permutaciones en orden lexicográfico de dígitos: la búsqueda es determinista.
    const walk = (index: number, sum: number, used: number): void => {
      if (index === k) {
        if (sum !== cage.sum) return;
        options.push(cage.cells.flatMap((cell, i) => itemsOf(cell, chosen[i]!)));
        cells.push(cage.cells);
        digits.push([...chosen]);
        return;
      }
      const cell = cage.cells[index]!;
      for (let digit = 1; digit <= size; digit++) {
        const bit = 1 << (digit - 1);
        if ((used & bit) !== 0 || (blocked[cell]! & bit) !== 0) continue;
        if (fixed[cell] !== 0 && fixed[cell] !== digit) continue;
        const [min, max] = bounds(k - index - 1, used | bit);
        if (sum + digit + min > cage.sum) break;
        if (sum + digit + max < cage.sum) continue;
        chosen[index] = digit;
        walk(index + 1, sum + digit, used | bit);
      }
    };
    walk(0, 0, 0);
  }

  return { itemCount: 4 * cellCount, options, cells, digits };
}
