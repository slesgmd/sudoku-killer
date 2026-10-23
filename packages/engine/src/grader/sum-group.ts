// Filtro de un conjunto de celdas con suma conocida (una jaula, o innies u outies): qué candidatos
// aparecen en alguna asignación que da la suma sin repetir dígito entre celdas que son pares.
import { at } from "../model/at.ts";
import { digitBit, digitsOf, popcount } from "../model/mask.ts";
import type { GraderContext } from "./context.ts";

export interface SumSupport {
  /** Candidatos de cada celda (en el orden de `cells`) que usa alguna asignación válida. */
  readonly support: number[];
  /**
   * Dígitos que están en todas las asignaciones válidas (0 si no hay ninguna). Solo se calcula si
   * se pide (`withRequired`); si no, vale 0.
   */
  readonly required: number;
}

/**
 * `sumSupport` con memoria: el resultado depende solo de los candidatos de `cells`, así que se
 * guarda el último de cada clave (una jaula o un grupo) y se reutiliza mientras esas máscaras no
 * cambien. Entre dos pasos del calificador cambian pocas celdas. Cada clave se usa siempre con las
 * mismas celdas, suma y `withRequired`.
 */
export function cachedSumSupport(
  context: GraderContext,
  candidates: Uint16Array,
  key: number,
  cells: readonly number[],
  sum: number,
  withRequired: boolean,
): SumSupport {
  const entry = context.supportCache[key];
  if (entry && cells.every((cell, i) => at(candidates, cell) === at(entry.masks, i))) {
    return entry.result;
  }
  const result = sumSupport(context, candidates, cells, sum, withRequired);
  context.supportCache[key] = { masks: cells.map((cell) => at(candidates, cell)), result };
  return result;
}

/**
 * Filtro exacto de `cells` con sus candidatos: una asignación válida suma `sum` y no repite dígito
 * entre pares. Por cada (celda, dígito) todavía sin soporte se busca una asignación que lo use, y
 * esa asignación da soporte a todas sus celdas. Un dígito es obligatorio si ninguna asignación lo
 * evita. Solo se usa con pocas celdas sin resolver: las resueltas no ramifican.
 */
export function sumSupport(
  context: GraderContext,
  candidates: Uint16Array,
  cells: readonly number[],
  sum: number,
  withRequired: boolean,
): SumSupport {
  const count = cells.length;
  // Primero las celdas con menos candidatos: las resueltas no ramifican y podan antes.
  const order = cells
    .map((cell, index) => ({ cell, index, mask: at(candidates, cell) }))
    .sort((a, b) => popcount(a.mask) - popcount(b.mask) || a.index - b.index);
  const search = createSearch(
    context,
    order.map(({ cell }) => cell),
    sum,
  );
  const masks = order.map(({ mask }) => mask);

  const support = new Array<number>(count).fill(0);
  const record = (assignment: readonly number[]): void => {
    assignment.forEach((digit, position) => {
      const { index } = at(order, position);
      support[index] = at(support, index) | digitBit(digit);
    });
  };
  order.forEach(({ index, mask }, position) => {
    for (const digit of digitsOf(mask & ~at(support, index))) {
      if ((at(support, index) & digitBit(digit)) !== 0) continue;
      const restricted = masks.slice();
      restricted[position] = digitBit(digit);
      const assignment = search(restricted);
      if (assignment) record(assignment);
    }
  });

  let required = 0;
  if (withRequired && support.some((mask) => mask !== 0)) {
    let union = 0;
    for (const mask of support) union |= mask;
    for (const digit of digitsOf(union)) {
      const bit = digitBit(digit);
      if (!search(masks.map((mask) => mask & ~bit))) required |= bit;
    }
  }
  return { support, required };
}

/**
 * Búsqueda en profundidad de una asignación de `cells` (en ese orden) que suma `sum`, sin repetir
 * dígito entre pares, con los candidatos que se le pasen. Devuelve la primera, o `null`.
 */
function createSearch(
  context: GraderContext,
  cells: readonly number[],
  sum: number,
): (masks: readonly number[]) => number[] | null {
  const { cellCount, isPeer } = context;
  const count = cells.length;
  // Pares anteriores de cada posición: con quién no puede repetir dígito.
  const earlierPeers = cells.map((cell, i) =>
    cells
      .slice(0, i)
      .flatMap((other, j) => (at(isPeer, cell * cellCount + other) === 1 ? [j] : [])),
  );
  // Si todas son pares entre sí (una jaula, o innies de una sola unidad), no repiten ningún dígito.
  const distinct = earlierPeers.every((peers, i) => peers.length === i);
  return (masks) => {
    const digits = masks.map(digitsOf);
    const minRest = new Array<number>(count + 1).fill(0);
    const maxRest = new Array<number>(count + 1).fill(0);
    const unionRest = new Array<number>(count + 1).fill(0);
    for (let i = count - 1; i >= 0; i--) {
      const own = at(digits, i);
      const low = own[0];
      const high = own.at(-1);
      if (low === undefined || high === undefined) return null;
      minRest[i] = at(minRest, i + 1) + low;
      maxRest[i] = at(maxRest, i + 1) + high;
      unionRest[i] = at(unionRest, i + 1) | at(masks, i);
    }
    const assigned = new Array<number>(count).fill(0);
    const visit = (depth: number, remaining: number, used: number): boolean => {
      if (depth === count) return remaining === 0;
      if (remaining < at(minRest, depth) || remaining > at(maxRest, depth)) return false;
      if (distinct && !distinctSumFits(at(unionRest, depth) & ~used, count - depth, remaining)) {
        return false;
      }
      const peers = at(earlierPeers, depth);
      for (const digit of at(digits, depth)) {
        if (digit > remaining) break;
        if (peers.some((j) => at(assigned, j) === digit)) continue;
        assigned[depth] = digit;
        if (visit(depth + 1, remaining - digit, used | digitBit(digit))) return true;
      }
      return false;
    };
    return visit(0, sum, 0) ? assigned : null;
  };
}

/** Si `count` dígitos distintos de `available` pueden sumar `sum`: entre los más chicos y los más grandes. */
function distinctSumFits(available: number, count: number, sum: number): boolean {
  const digits = digitsOf(available);
  if (digits.length < count) return false;
  let low = 0;
  let high = 0;
  for (let i = 0; i < count; i++) {
    low += at(digits, i);
    high += at(digits, digits.length - 1 - i);
  }
  return sum >= low && sum <= high;
}

/**
 * Cotas de suma: cada celda queda entre `sum` menos el máximo de las demás y `sum` menos su mínimo.
 * Ignora que las celdas no repiten dígito, así que vale para cualquier grupo. Devuelve los
 * candidatos de cada celda (en el orden de `cells`) dentro de sus cotas.
 */
export function sumBounds(
  candidates: Uint16Array,
  cells: readonly number[],
  sum: number,
): number[] {
  let minTotal = 0;
  let maxTotal = 0;
  const lows: number[] = [];
  const highs: number[] = [];
  for (const cell of cells) {
    const mask = at(candidates, cell);
    const low = 32 - Math.clz32(mask & -mask);
    const high = 32 - Math.clz32(mask);
    lows.push(low);
    highs.push(high);
    minTotal += low;
    maxTotal += high;
  }
  return cells.map((cell, i) => {
    const low = sum - (maxTotal - at(highs, i));
    const high = sum - (minTotal - at(lows, i));
    let allowed = 0;
    for (const digit of digitsOf(at(candidates, cell))) {
      if (digit >= low && digit <= high) allowed |= digitBit(digit);
    }
    return allowed;
  });
}
