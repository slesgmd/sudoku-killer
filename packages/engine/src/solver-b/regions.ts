import type { KillerPuzzle } from "../types.ts";
import type { ExactCover } from "./matrix.ts";

/**
 * Regiones con suma conocida (regla del 45): uniones de unidades completas, que suman
 * `unidades · size · (size + 1) / 2`. Las jaulas enteras dentro de una región se restan de su
 * total; cada jaula que la corta aporta la suma de sus celdas dentro de ella, que depende de la
 * opción elegida para la jaula. Un *slot* es un par (jaula, región) con celdas en común.
 */
export interface Regions {
  /** Suma que les falta a las jaulas que cortan cada región. */
  readonly total: Int32Array;
  /** Slots de cada región: de `regionStart[r]` a `regionStart[r + 1]`. */
  readonly regionStart: Int32Array;
  readonly slotRegion: Int32Array;
  readonly slotCage: Int32Array;
  /** Slots de cada jaula: `cageSlot[i]` para `i` de `cageStart[c]` a `cageStart[c + 1]`. */
  readonly cageStart: Int32Array;
  readonly cageSlot: Int32Array;
  /** Por opción, de `optionStart[o]` a `optionStart[o + 1]`: slot y suma parcial. */
  readonly optionStart: Int32Array;
  readonly entrySlot: Int32Array;
  readonly entrySum: Int32Array;
}

/**
 * Filas, columnas y cajas, las uniones de filas o columnas consecutivas y el tablero entero. Se
 * midieron también pares y bloques de 2 × 2 cajas: casi no reducen nodos y encarecen cada uno.
 */
function unitUnions(puzzle: KillerPuzzle): number[][] {
  const { size, boxRows, boxCols } = puzzle;
  const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
  const rows = range(size).map((r) => range(size).map((c) => r * size + c));
  const cols = range(size).map((c) => range(size).map((r) => r * size + c));
  const regions: number[][] = [];
  for (const lines of [rows, cols]) {
    // El tablero entero va una sola vez, como unión de todas las filas.
    for (let count = 1; count <= (lines === rows ? size : size - 1); count++) {
      for (let first = 0; first + count <= size; first++) {
        regions.push(lines.slice(first, first + count).flat());
      }
    }
  }
  // Hay `boxRows` cajas por banda (size / boxCols).
  for (let box = 0; box < size; box++) {
    const top = Math.floor(box / boxRows) * boxRows;
    const leftCol = (box % boxRows) * boxCols;
    regions.push(
      range(size).map((i) => (top + Math.floor(i / boxCols)) * size + leftCol + (i % boxCols)),
    );
  }
  return regions;
}

export function buildRegions(puzzle: KillerPuzzle, matrix: ExactCover): Regions {
  const { size, cages } = puzzle;
  const unitSum = (size * (size + 1)) / 2;
  const cageOf = new Int32Array(size * size);
  cages.forEach((cage, index) => {
    for (const cell of cage.cells) cageOf[cell] = index;
  });

  const total: number[] = [];
  const regionStart = [0];
  const slotRegion: number[] = [];
  const slotCage: number[] = [];
  /** Celdas de cada región, como marcas por celda. */
  const insides: Uint8Array[] = [];
  for (const cells of unitUnions(puzzle)) {
    const inside = new Uint8Array(size * size);
    for (const cell of cells) inside[cell] = 1;
    let rest = (cells.length / size) * unitSum;
    const cut: number[] = [];
    cages.forEach((cage, index) => {
      const count = cage.cells.filter((cell) => inside[cell] === 1).length;
      if (count === cage.cells.length) rest -= cage.sum;
      else if (count > 0) cut.push(index);
    });
    // Sin jaulas que la corten, la región solo importa si su total no cuadra: entonces no hay
    // solución, y la poda lo detecta en la raíz.
    if (cut.length === 0 && rest === 0) continue;
    for (const cage of cut) {
      slotRegion.push(total.length);
      slotCage.push(cage);
    }
    total.push(rest);
    regionStart.push(slotRegion.length);
    insides.push(inside);
  }

  const cageStart = [0];
  const cageSlot: number[] = [];
  cages.forEach((_, cage) => {
    slotCage.forEach((owner, slot) => {
      if (owner === cage) cageSlot.push(slot);
    });
    cageStart.push(cageSlot.length);
  });

  const optionStart = [0];
  const entrySlot: number[] = [];
  const entrySum: number[] = [];
  matrix.cells.forEach((cells, option) => {
    const digits = matrix.digits[option]!;
    const cage = cageOf[cells[0]!]!;
    for (let i = cageStart[cage]!; i < cageStart[cage + 1]!; i++) {
      const slot = cageSlot[i]!;
      const inside = insides[slotRegion[slot]!]!;
      let sum = 0;
      cells.forEach((cell, j) => {
        if (inside[cell] === 1) sum += digits[j]!;
      });
      entrySlot.push(slot);
      entrySum.push(sum);
    }
    optionStart.push(entrySlot.length);
  });

  return {
    total: Int32Array.from(total),
    regionStart: Int32Array.from(regionStart),
    slotRegion: Int32Array.from(slotRegion),
    slotCage: Int32Array.from(slotCage),
    cageStart: Int32Array.from(cageStart),
    cageSlot: Int32Array.from(cageSlot),
    optionStart: Int32Array.from(optionStart),
    entrySlot: Int32Array.from(entrySlot),
    entrySum: Int32Array.from(entrySum),
  };
}
