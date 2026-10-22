// Propagación del solver A: singles, hidden singles, filtro exacto por combinaciones (jaulas e
// innies/outies pequeños) y cotas de suma (innies/outies grandes). Trabaja sobre los candidatos
// en el lugar y devuelve false si encuentra una contradicción.
import type { Context, Group } from "./context.ts";

const FAIL = -1;
const UNCHANGED = 0;
const CHANGED = 1;

/**
 * Reduce los candidatos de una celda a `mask` (nunca vacío): marca sus grupos para refiltrarlos y,
 * si queda un solo candidato, la pone en la cola de singles.
 */
function narrow(
  ctx: Context,
  cand: Uint16Array,
  dirty: Uint8Array,
  cell: number,
  mask: number,
): void {
  cand[cell] = mask;
  for (const group of ctx.groupsOf[cell]!) dirty[group] = 1;
  if ((mask & (mask - 1)) === 0) ctx.queue[ctx.work.queued++] = cell;
}

/** dom/wdeg: suma peso a las celdas de la restricción que falló. */
function blame(ctx: Context, cells: Iterable<number>): false {
  for (const cell of cells) ctx.weights[cell]! += 1;
  return false;
}

/**
 * Busca una asignación de los dígitos de `remaining` a las celdas `i..` distintas de `fixed`, sin
 * repetir, y la deja en `path`. Se detiene en la primera.
 */
function complete(
  ctx: Context,
  cand: Uint16Array,
  cells: Int16Array,
  fixed: number,
  i: number,
  remaining: number,
): boolean {
  if (i === fixed) i++;
  if (i === cells.length) return true;
  const { path } = ctx;
  for (let m = cand[cells[i]!]! & remaining; m !== 0; m &= m - 1) {
    const bit = m & -m;
    path[i] = bit;
    if (complete(ctx, cand, cells, fixed, i + 1, remaining ^ bit)) return true;
  }
  return false;
}

/**
 * Suma al soporte los dígitos de `combo` que admiten una asignación completa: para cada celda y
 * cada dígito todavía sin soporte, busca una asignación que lo use. Cada una encontrada da soporte
 * a todas las celdas a la vez. Devuelve false si demuestra que la combinación no cabe.
 */
function supportCombo(ctx: Context, cand: Uint16Array, cells: Int16Array, combo: number): boolean {
  const { support, path } = ctx;
  const k = cells.length;
  let found = false;
  let firstAll = true;
  for (let i = 0; i < k; i++) {
    const options = cand[cells[i]!]! & combo;
    if (i === 0 && (options & support[0]!) !== 0) firstAll = false;
    for (let todo = options & ~support[i]!; todo !== 0; todo &= ~support[i]!) {
      const bit = todo & -todo;
      todo ^= bit;
      path[i] = bit;
      if (!complete(ctx, cand, cells, i, 0, combo ^ bit)) continue;
      found = true;
      for (let j = 0; j < k; j++) support[j] = support[j]! | path[j]!;
    }
  }
  // Sin ninguna asignación y con todos los dígitos de la primera celda probados, no cabe.
  return found || !firstAll;
}

/**
 * Un dígito que está en todas las combinaciones posibles del grupo va en alguna de sus celdas: si
 * las que lo admiten comparten fila, columna o caja, sale del resto de esa unidad.
 */
function pointRequired(
  ctx: Context,
  cand: Uint16Array,
  dirty: Uint8Array,
  cells: Int16Array,
  required: number,
): number {
  const { size, rowOf, colOf, boxOf, units } = ctx;
  let result = UNCHANGED;
  for (let m = required; m !== 0; m &= m - 1) {
    const bit = m & -m;
    let row = -1;
    let col = -1;
    let box = -1;
    let holders = 0;
    let holder = -1;
    for (const cell of cells) {
      if ((cand[cell]! & bit) === 0) continue;
      holders++;
      holder = cell;
      // -1: sin celdas todavía; -2: celdas en unidades distintas.
      row = row === -1 || row === rowOf[cell] ? rowOf[cell]! : -2;
      col = col === -1 || col === colOf[cell] ? colOf[cell]! : -2;
      box = box === -1 || box === boxOf[cell] ? boxOf[cell]! : -2;
    }
    if (holders === 0) return FAIL;
    // Una sola celda lo admite: va ahí, y los singles lo quitan de sus pares.
    if (holders === 1) {
      if (cand[holder] !== bit) {
        narrow(ctx, cand, dirty, holder, bit);
        result = CHANGED;
      }
      continue;
    }
    // Las unidades van en orden: filas, columnas y cajas.
    for (let kind = 0; kind < 3; kind++) {
      const index = kind === 0 ? row : kind === 1 ? col : box;
      if (index < 0) continue;
      for (const cell of units[kind * size + index]!) {
        const mask = cand[cell]!;
        if ((mask & bit) === 0 || cells.includes(cell)) continue;
        if (mask === bit) return FAIL;
        narrow(ctx, cand, dirty, cell, mask & ~bit);
        result = CHANGED;
      }
    }
  }
  return result;
}

/**
 * Deja en cada celda solo los dígitos que aparecen en alguna asignación completa: una combinación
 * de la tabla (que ya fija la suma) repartida entre las celdas sin repetir. Es la consistencia
 * exacta del grupo, así que incluye sus cotas de suma y sus hidden singles.
 */
function filterExact(
  ctx: Context,
  cand: Uint16Array,
  dirty: Uint8Array,
  cells: Int16Array,
  combos: readonly number[],
): number {
  const { support } = ctx;
  const k = cells.length;
  support.fill(0, 0, k);
  // Dígitos de todas las combinaciones posibles. Las que no se recorren cuentan como posibles.
  let required = ctx.full;

  for (const combo of combos) {
    let union = 0;
    let fresh = false;
    let fits = true;
    for (let i = 0; i < k; i++) {
      const m = cand[cells[i]!]! & combo;
      if (m === 0) {
        fits = false;
        break;
      }
      union |= m;
      if ((m & ~support[i]!) !== 0) fresh = true;
    }
    // Sin cobertura completa no hay asignación; sin dígitos nuevos no hay nada que aprender.
    if (!fits || union !== combo) continue;
    if (!fresh || supportCombo(ctx, cand, cells, combo)) required &= combo;
  }

  let result = UNCHANGED;
  for (let i = 0; i < k; i++) {
    const cell = cells[i]!;
    const mask = cand[cell]! & support[i]!;
    if (mask === 0) return FAIL;
    if (mask !== cand[cell]) {
      narrow(ctx, cand, dirty, cell, mask);
      result = CHANGED;
    }
  }
  if (required === 0) return result;
  const pointed = pointRequired(ctx, cand, dirty, cells, required);
  return pointed === UNCHANGED ? result : pointed;
}

/** Dígitos de `min` a `max`, recortados a 1..16. */
function rangeMask(min: number, max: number): number {
  const low = Math.max(min, 1);
  const high = Math.min(max, 16);
  if (low > high) return 0;
  return ((1 << high) - 1) & ~((1 << (low - 1)) - 1);
}

/**
 * Cotas de suma para celdas que pueden repetir dígitos: cada celda queda entre la suma menos el
 * máximo y la suma menos el mínimo de las demás.
 */
function filterBounds(
  ctx: Context,
  cand: Uint16Array,
  dirty: Uint8Array,
  cells: Int16Array,
  sum: number,
): number {
  let low = 0;
  let high = 0;
  for (const cell of cells) {
    const mask = cand[cell]!;
    low += 32 - Math.clz32(mask & -mask);
    high += 32 - Math.clz32(mask);
  }
  if (sum < low || sum > high) return FAIL;
  let result = UNCHANGED;
  for (const cell of cells) {
    const mask = cand[cell]!;
    const lowest = 32 - Math.clz32(mask & -mask);
    const highest = 32 - Math.clz32(mask);
    const allowed = mask & rangeMask(sum - (high - highest), sum - (low - lowest));
    if (allowed === 0) return FAIL;
    if (allowed !== mask) {
      narrow(ctx, cand, dirty, cell, allowed);
      result = CHANGED;
    }
  }
  return result;
}

function unionOf(cand: Uint16Array, cells: Int16Array): number {
  let mask = 0;
  for (const cell of cells) mask |= cand[cell]!;
  return mask;
}

/** Quita los dígitos de `mask` de las celdas. */
function eliminate(
  ctx: Context,
  cand: Uint16Array,
  dirty: Uint8Array,
  cells: Int16Array,
  mask: number,
): number {
  let result = UNCHANGED;
  for (const cell of cells) {
    const current = cand[cell]!;
    if ((current & mask) === 0) continue;
    if ((current & ~mask) === 0) return FAIL;
    narrow(ctx, cand, dirty, cell, current & ~mask);
    result = CHANGED;
  }
  return result;
}

function filterGroup(ctx: Context, cand: Uint16Array, dirty: Uint8Array, group: Group): number {
  return group.combos
    ? filterExact(ctx, cand, dirty, group.cells, group.combos)
    : filterBounds(ctx, cand, dirty, group.cells, group.sum);
}

/**
 * Propaga hasta un punto fijo. `placed` marca las celdas cuyo dígito ya se quitó de sus pares;
 * `dirty` marca los grupos con candidatos cambiados desde su último filtro, y queda en cero. Las
 * reglas baratas y locales van primero; las que recorren todas las unidades, solo cuando aquellas
 * ya no avanzan.
 */
export function propagate(
  ctx: Context,
  cand: Uint16Array,
  placed: Uint8Array,
  dirty: Uint8Array,
): boolean {
  const { cellCount, full, units, segments, peers, groups, queue, work } = ctx;
  work.queued = 0;
  for (let cell = 0; cell < cellCount; cell++) {
    const mask = cand[cell]!;
    if (mask === 0) return false;
    if (!placed[cell] && (mask & (mask - 1)) === 0) queue[work.queued++] = cell;
  }

  for (;;) {
    // Singles: una celda con un solo candidato lo quita de sus pares.
    while (work.queued > 0) {
      const cell = queue[--work.queued]!;
      if (placed[cell]) continue;
      placed[cell] = 1;
      const mask = cand[cell]!;
      for (const peer of peers[cell]!) {
        const peerMask = cand[peer]!;
        if ((peerMask & mask) === 0) continue;
        if (peerMask === mask) return blame(ctx, [cell, peer]);
        narrow(ctx, cand, dirty, peer, peerMask & ~mask);
      }
    }

    // Grupos de suma: jaulas, innies y outies cuyas celdas cambiaron.
    let progress = false;
    for (let index = 0; index < groups.length; index++) {
      if (!dirty[index]) continue;
      dirty[index] = 0;
      const group = groups[index]!;
      const result = filterGroup(ctx, cand, dirty, group);
      if (result === FAIL) return blame(ctx, group.cells);
      if (result === CHANGED) {
        progress = true;
        // El filtro exacto es idempotente: no hace falta repetirlo hasta que cambie otra celda.
        if (group.combos) dirty[index] = 0;
      }
    }
    if (progress) continue;

    // Hidden singles: un dígito que en su fila, columna o caja solo cabe en una celda.
    for (const unit of units) {
      let once = 0;
      let twice = 0;
      for (const cell of unit) {
        const mask = cand[cell]!;
        twice |= once & mask;
        once |= mask;
      }
      if (once !== full) return blame(ctx, unit);
      const unique = once & ~twice;
      if (unique === 0) continue;
      for (const cell of unit) {
        const mask = cand[cell]! & unique;
        if (mask === 0) continue;
        // Dos dígitos que solo caben en la misma celda.
        if ((mask & (mask - 1)) !== 0) return blame(ctx, unit);
        if (mask === cand[cell]) continue;
        narrow(ctx, cand, dirty, cell, mask);
        progress = true;
      }
    }
    if (progress) continue;

    // Locked candidates: un dígito que en la caja solo cabe en el cruce con una línea sale del
    // resto de la línea, y al revés.
    for (const { shared, boxRest, lineRest } of segments) {
      const here = unionOf(cand, shared);
      const boxLocked = here & ~unionOf(cand, boxRest);
      const lineLocked = here & ~unionOf(cand, lineRest);
      if (boxLocked !== 0) {
        const result = eliminate(ctx, cand, dirty, lineRest, boxLocked);
        if (result === FAIL) return blame(ctx, lineRest);
        if (result === CHANGED) progress = true;
      }
      if (lineLocked !== 0) {
        const result = eliminate(ctx, cand, dirty, boxRest, lineLocked);
        if (result === FAIL) return blame(ctx, boxRest);
        if (result === CHANGED) progress = true;
      }
    }
    if (!progress) return true;
  }
}
