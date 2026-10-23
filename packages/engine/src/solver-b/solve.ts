import type { Grid, KillerPuzzle } from "../types.ts";
import { buildLinks, cover, hide, uncover, unhide, type Links } from "./dlx.ts";
import { buildExactCover, type ExactCover } from "./matrix.ts";
import { buildRegions, type Regions } from "./regions.ts";

export interface SolveBOptions {
  /** Soluciones a buscar antes de detenerse (por defecto 2: basta para saber si es única). */
  readonly limit?: number;
  /**
   * Poda propia de B (por defecto, activada): las reglas 1 a 3 y el descarte de opciones que
   * repiten un número inicial de su fila, columna o caja. Con `false` queda Dancing Links puro,
   * que sirve de referencia para comprobar que la poda no pierde soluciones (docs/motor.md).
   */
  readonly prune?: boolean;
}

export interface SolveBResult {
  /** 0 sin solución, 1 con una sola y 2 con dos o más (o con una, si `limit` es 1). */
  readonly count: 0 | 1 | 2;
  /** Las soluciones encontradas, como mucho `limit`, en el orden de la búsqueda. */
  readonly solutions: readonly Grid[];
  /** Nodos de búsqueda: coberturas parciales visitadas, incluida la vacía. */
  readonly nodes: number;
}

/**
 * Estado de una búsqueda. Las cachés (`*Key`) guardan con qué cantidad de opciones activas se
 * evaluó por última vez un ítem o una jaula. Bajando por la búsqueda las opciones solo se quitan,
 * así que la misma cantidad implica el mismo conjunto y no hace falta reevaluar. Al volver de un
 * nodo, `search` restaura las cachés y las cotas tal como estaban al entrar.
 */
interface Run {
  readonly matrix: ExactCover;
  readonly links: Links;
  readonly regions: Regions;
  readonly cellCount: number;
  readonly limit: number;
  readonly prune: boolean;
  /** Cabecera del ítem de la primera celda de cada jaula: sus opciones son las de la jaula. */
  readonly cageHeader: Int32Array;
  readonly optionCage: Int32Array;
  /** Opción elegida para cada jaula (−1 si todavía no tiene). */
  readonly chosenOf: Int32Array;
  readonly chosen: number[];
  /** Opciones ocultas por la poda, en orden, para restaurarlas al volver. */
  readonly trail: number[];

  /** Regla 1: opciones del ítem cuando se evaluó. */
  readonly itemKey: Int32Array;
  /** Regla 2: opciones de la jaula cuando se evaluó. */
  readonly forcedKey: Int32Array;
  /** Regla 3: suma parcial mínima y máxima de cada slot entre las opciones activas de su jaula. */
  readonly slotMin: Int32Array;
  readonly slotMax: Int32Array;
  /** Opciones de la jaula (o `−2 − opción` si ya se eligió) con las que se calcularon sus slots. */
  readonly slotKey: Int32Array;
  readonly regionMin: Int32Array;
  readonly regionMax: Int32Array;
  /** Copia por profundidad de las cachés y las cotas. */
  readonly saved: Int32Array[];

  /** Marcas por opción e ítem, válidas mientras coincidan con `stamp`. */
  readonly optionMark: Int32Array;
  readonly itemMark: Int32Array;
  readonly itemCount: Int32Array;
  stamp: number;
  readonly solutions: Grid[];
  depth: number;
  nodes: number;
}

const FAILED = -1;
const UNCHANGED = 0;
const CHANGED = 1;
type Outcome = typeof FAILED | typeof UNCHANGED | typeof CHANGED;

const NO_SUM = 0x7fffffff;

function record(run: Run): void {
  const grid = new Array<number>(run.cellCount).fill(0);
  for (const option of run.chosen) {
    const digits = run.matrix.digits[option]!;
    run.matrix.cells[option]!.forEach((cell, i) => (grid[cell] = digits[i]!));
  }
  run.solutions.push(grid);
}

function hideOption(run: Run, row: number): void {
  hide(run.links, row);
  run.trail.push(row);
}

function restore(run: Run, mark: number): void {
  while (run.trail.length > mark) unhide(run.links, run.trail.pop()!);
}

/**
 * Regla 1: si todas las opciones de un ítem de dígito son de la misma jaula, esa jaula tiene que
 * usar una de ellas; se ocultan sus demás opciones. Los ítems de celda se saltan: sus opciones son
 * siempre las de su jaula.
 */
function cageOwnsItem(run: Run): Outcome {
  const { links, optionCage, cageHeader, itemKey, optionMark } = run;
  const { right, down, option, length } = links;
  let outcome: Outcome = UNCHANGED;
  for (let item = right[0]!; item !== 0; item = right[item]!) {
    if (item <= run.cellCount) continue;
    const first = down[item]!;
    if (first === item) return FAILED;
    if (itemKey[item] === length[item]) continue;
    itemKey[item] = length[item]!;
    const cage = optionCage[option[first]!]!;
    let single = true;
    for (let row = down[first]!; row !== item && single; row = down[row]!) {
      single = optionCage[option[row]!] === cage;
    }
    const header = cageHeader[cage]!;
    if (!single || length[header] === length[item]) continue;
    const stamp = ++run.stamp;
    for (let row = down[item]!; row !== item; row = down[row]!) optionMark[option[row]!] = stamp;
    for (let row = down[header]!; row !== header; row = down[row]!) {
      if (optionMark[option[row]!] !== stamp) {
        hideOption(run, row);
        outcome = CHANGED;
      }
    }
  }
  return outcome;
}

/**
 * Regla 2: si todas las opciones de una jaula cubren un ítem de dígito (la jaula pone ese dígito
 * en esa fila, columna o caja sea cual sea su opción), ninguna otra jaula puede cubrirlo.
 */
function cageForcesItem(run: Run): Outcome {
  const { links, optionCage, cageHeader, chosenOf, forcedKey, itemMark, itemCount } = run;
  const { right, down, option, length, top } = links;
  let outcome: Outcome = UNCHANGED;
  for (let cage = 0; cage < cageHeader.length; cage++) {
    if (chosenOf[cage]! >= 0) continue;
    const header = cageHeader[cage]!;
    const options = length[header]!;
    if (options === 0) return FAILED;
    if (forcedKey[cage] === options) continue;
    forcedKey[cage] = options;
    const stamp = ++run.stamp;
    for (let row = down[header]!; row !== header; row = down[row]!) {
      for (let node = right[row]!; node !== row; node = right[node]!) {
        const item = top[node]!;
        if (itemMark[item] !== stamp) {
          itemMark[item] = stamp;
          itemCount[item] = 0;
        }
        itemCount[item]!++;
      }
    }
    // Los ítems cubiertos por todas las opciones están en cualquiera de ellas: basta la primera.
    const first = down[header]!;
    for (let node = right[first]!; node !== first; node = right[node]!) {
      const item = top[node]!;
      if (item <= run.cellCount || itemCount[item] !== options || length[item] === options) {
        continue;
      }
      for (let row = down[item]!; row !== item;) {
        const next = down[row]!;
        if (optionCage[option[row]!] !== cage) {
          hideOption(run, row);
          outcome = CHANGED;
        }
        row = next;
      }
    }
  }
  return outcome;
}

/** Amplía las cotas de los slots de la jaula de `option` con sus sumas parciales. */
function widen(run: Run, option: number): void {
  const { optionStart, entrySlot, entrySum } = run.regions;
  const { slotMin, slotMax } = run;
  for (let entry = optionStart[option]!; entry < optionStart[option + 1]!; entry++) {
    const slot = entrySlot[entry]!;
    const sum = entrySum[entry]!;
    if (sum < slotMin[slot]!) slotMin[slot] = sum;
    if (sum > slotMax[slot]!) slotMax[slot] = sum;
  }
}

/**
 * Regla 3, la del 45: oculta las opciones con las que alguna región ya no puede llegar a su total,
 * dadas las cotas de las demás jaulas que la cortan.
 */
function regionSums(run: Run): Outcome {
  const { links, regions, chosenOf, cageHeader, slotKey, slotMin, slotMax } = run;
  const { regionMin, regionMax } = run;
  const { total, regionStart, slotRegion, cageStart, cageSlot } = regions;
  const { optionStart, entrySlot, entrySum } = regions;
  const { down, option, length } = links;
  const cageCount = cageHeader.length;

  for (let cage = 0; cage < cageCount; cage++) {
    const chosen = chosenOf[cage]!;
    const header = cageHeader[cage]!;
    if (chosen < 0 && length[header] === 0) return FAILED;
    const key = chosen >= 0 ? -2 - chosen : length[header]!;
    if (key === slotKey[cage]) continue;
    slotKey[cage] = key;
    for (let i = cageStart[cage]!; i < cageStart[cage + 1]!; i++) {
      slotMin[cageSlot[i]!] = NO_SUM;
      slotMax[cageSlot[i]!] = -1;
    }
    if (chosen >= 0) widen(run, chosen);
    else for (let row = down[header]!; row !== header; row = down[row]!) widen(run, option[row]!);
  }

  for (let region = 0; region < total.length; region++) {
    let min = 0;
    let max = 0;
    for (let slot = regionStart[region]!; slot < regionStart[region + 1]!; slot++) {
      min += slotMin[slot]!;
      max += slotMax[slot]!;
    }
    if (min > total[region]! || max < total[region]!) return FAILED;
    regionMin[region] = min;
    regionMax[region] = max;
  }

  // Una opción es viable en un slot si su suma cabe entre `low` y `high`: lo que le falta a la
  // región con las demás jaulas al máximo y al mínimo. Solo se recorren las jaulas con algún slot
  // cuyas cotas excedan ese margen.
  const low = (slot: number): number => {
    const region = slotRegion[slot]!;
    return total[region]! - regionMax[region]! + slotMax[slot]!;
  };
  const high = (slot: number): number => {
    const region = slotRegion[slot]!;
    return total[region]! - regionMin[region]! + slotMin[slot]!;
  };
  let outcome: Outcome = UNCHANGED;
  for (let cage = 0; cage < cageCount; cage++) {
    if (chosenOf[cage]! >= 0) continue;
    let tight = false;
    for (let i = cageStart[cage]!; i < cageStart[cage + 1]! && !tight; i++) {
      const slot = cageSlot[i]!;
      tight = slotMin[slot]! < low(slot) || slotMax[slot]! > high(slot);
    }
    if (!tight) continue;
    const header = cageHeader[cage]!;
    for (let row = down[header]!; row !== header; row = down[row]!) {
      const opt = option[row]!;
      for (let entry = optionStart[opt]!; entry < optionStart[opt + 1]!; entry++) {
        const slot = entrySlot[entry]!;
        const sum = entrySum[entry]!;
        if (sum < low(slot) || sum > high(slot)) {
          hideOption(run, row);
          outcome = CHANGED;
          break;
        }
      }
    }
  }
  return outcome;
}

/**
 * Poda hasta un punto fijo. Las reglas 1 y 2 son de cobertura exacta (un ítem y una jaula que se
 * implican); la 3 usa las sumas. Ocultar opciones es como en Dancing Links: `restore` las devuelve
 * en orden inverso. Devuelve false si la cobertura ya no es posible.
 */
function prune(run: Run): boolean {
  for (;;) {
    let outcome: Outcome;
    do {
      const owned = cageOwnsItem(run);
      if (owned === FAILED) return false;
      const forced = cageForcesItem(run);
      if (forced === FAILED) return false;
      outcome = owned === CHANGED || forced === CHANGED ? CHANGED : UNCHANGED;
    } while (outcome === CHANGED);
    outcome = regionSums(run);
    if (outcome === FAILED) return false;
    if (outcome === UNCHANGED) return true;
  }
}

/** MRV: el ítem con menos opciones; ante un empate, el primero de la lista (el de menor índice). */
function choose(links: Links): number {
  const { right, length } = links;
  let header = right[0]!;
  for (let item = right[header]!; item !== 0 && length[header]! > 1; item = right[item]!) {
    if (length[item]! < length[header]!) header = item;
  }
  return header;
}

function explore(run: Run): void {
  run.nodes++;
  const { links } = run;
  const { right, left, down, top, option, length } = links;
  if (right[0] === 0) {
    record(run);
    return;
  }

  // Un ítem con una sola opción es una jugada forzada: se toma sin podar.
  const mark = run.trail.length;
  let header = choose(links);
  if (run.prune && length[header]! > 1) {
    if (!prune(run)) {
      restore(run, mark);
      return;
    }
    header = choose(links);
  }
  if (length[header] === 0) {
    restore(run, mark);
    return;
  }

  cover(links, header);
  for (let row = down[header]!; row !== header && run.solutions.length < run.limit;) {
    const opt = option[row]!;
    run.chosen.push(opt);
    run.chosenOf[run.optionCage[opt]!] = opt;
    for (let node = right[row]!; node !== row; node = right[node]!) cover(links, top[node]!);
    search(run);
    for (let node = left[row]!; node !== row; node = left[node]!) uncover(links, top[node]!);
    run.chosenOf[run.optionCage[opt]!] = -1;
    run.chosen.pop();
    row = down[row]!;
  }
  uncover(links, header);
  restore(run, mark);
}

function search(run: Run): void {
  const state = [run.itemKey, run.forcedKey, run.slotKey, run.slotMin, run.slotMax];
  const size = state.reduce((total, array) => total + array.length, 0);
  const saved = (run.saved[run.depth] ??= new Int32Array(size));
  let offset = 0;
  for (const array of state) {
    saved.set(array, offset);
    offset += array.length;
  }
  run.depth++;
  explore(run);
  run.depth--;
  offset = 0;
  for (const array of state) {
    array.set(saved.subarray(offset, offset + array.length));
    offset += array.length;
  }
}

/**
 * Solver B (SPEC R-35): cobertura exacta con Dancing Links y una poda propia. No comparte código
 * con el solver A. Misma semántica que `solveA`: cuenta soluciones y se detiene al llegar a
 * `limit`. Lanza `RangeError` si la entrada no define la matriz (ver `buildExactCover`) o si
 * `limit` no es un entero ≥ 1 ni `Infinity`. Determinista: las opciones siguen el orden de las
 * jaulas y, dentro de cada una, el orden lexicográfico de los dígitos.
 */
export function solveB(puzzle: KillerPuzzle, options: SolveBOptions = {}): SolveBResult {
  const limit = options.limit ?? 2;
  if (!(Number.isInteger(limit) || limit === Infinity) || limit < 1) {
    throw new RangeError(`Invalid limit ${String(limit)}`);
  }
  const prune = options.prune ?? true;
  const matrix = buildExactCover(puzzle, prune);
  const regions = buildRegions(puzzle, matrix);
  const cageOf = new Int32Array(puzzle.size * puzzle.size);
  puzzle.cages.forEach((cage, index) => {
    for (const cell of cage.cells) cageOf[cell] = index;
  });
  const cageCount = puzzle.cages.length;
  const headers = matrix.itemCount + 1;
  const slots = regions.slotRegion.length;
  const run: Run = {
    matrix,
    links: buildLinks(matrix.itemCount, matrix.options),
    regions,
    cellCount: puzzle.size * puzzle.size,
    limit,
    prune,
    cageHeader: Int32Array.from(puzzle.cages, (cage) => cage.cells[0]! + 1),
    optionCage: Int32Array.from(matrix.cells, (cells) => cageOf[cells[0]!]!),
    chosenOf: new Int32Array(cageCount).fill(-1),
    chosen: [],
    trail: [],
    itemKey: new Int32Array(headers).fill(-1),
    forcedKey: new Int32Array(cageCount).fill(-1),
    slotMin: new Int32Array(slots),
    slotMax: new Int32Array(slots),
    slotKey: new Int32Array(cageCount).fill(-1),
    regionMin: new Int32Array(regions.total.length),
    regionMax: new Int32Array(regions.total.length),
    saved: [],
    optionMark: new Int32Array(matrix.options.length),
    itemMark: new Int32Array(headers),
    itemCount: new Int32Array(headers),
    stamp: 0,
    solutions: [],
    depth: 0,
    nodes: 0,
  };
  search(run);

  const found = run.solutions.length;
  return {
    count: found === 0 ? 0 : found === 1 ? 1 : 2,
    solutions: run.solutions,
    nodes: run.nodes,
  };
}
