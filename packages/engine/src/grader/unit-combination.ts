// Nivel 5: combinaciones de una unidad entera con sus jaulas. Generaliza la regla del 45 y las
// combinaciones de jaula: una fila, columna o caja usa cada dígito una vez, y las jaulas que la
// tocan tienen que cuadrar a la vez. La técnica se acota a unidades que una persona puede
// razonar con notas: pocas jaulas abiertas y pocas combinaciones.
import { at } from "../model/at.ts";
import { digitBit, digitsOf, popcount } from "../model/mask.ts";
import type { GraderContext, UnitCacheEntry } from "./context.ts";
import type { GraderState } from "./state.ts";
import { eliminationCollector } from "./subsets.ts";
import type { Technique } from "./types.ts";

/**
 * Cota de `unitCombination`: la técnica solo mira una unidad con como mucho `maxOpenCages` jaulas
 * abiertas (con alguna celda vacía dentro de la unidad) y `maxCombinations` combinaciones. Una
 * combinación es una forma de repartir los dígitos de la unidad entre sus jaulas (un conjunto de
 * dígitos por jaula, sin repetir entre jaulas) en la que cada jaula cuadra con los candidatos.
 */
export interface UnitCombinationBound {
  readonly maxOpenCages: number;
  readonly maxCombinations: number;
}

/** Sin cota: la enumeración completa. Solo para medir. */
export const UNBOUNDED: UnitCombinationBound = {
  maxOpenCages: Infinity,
  maxCombinations: Infinity,
};

/**
 * Combinaciones de unidad dentro de la cota: un candidato de una celda de la unidad que no aparece
 * en ninguna forma de llenarla con todos sus dígitos, en la que cada jaula que la toca cuadre, sale
 * de la celda. Una jaula entera dentro de la unidad tiene que sumar justo; una que sobresale, poder
 * completarse fuera con sus candidatos, sin repetir dígito en la jaula. Con menos candidatos o más
 * celdas colocadas, las jaulas abiertas y las combinaciones no suben, así que una unidad que entra
 * en la cota sigue entrando (T-35.5).
 */
export function unitCombinationWithin({
  maxOpenCages,
  maxCombinations,
}: UnitCombinationBound): Technique {
  return {
    id: "unitCombination",
    level: 5,
    find: (context, state) => {
      const { deductions, eliminate } = eliminationCollector(state);
      context.units.forEach((unit, index) => {
        if (unit.every((cell) => popcount(at(state.candidates, cell)) === 1)) return;
        const pieces = piecesOf(context, unit);
        if (openCages(state, pieces) > maxOpenCages) return;
        const support = cachedUnitSupport(
          context,
          state.candidates,
          index,
          pieces,
          maxCombinations,
        );
        if (!support) return;
        unit.forEach((cell, i) => {
          if (at(state.values, cell) === 0) eliminate(cell, ~at(support, i));
        });
      });
      return deductions;
    },
  };
}

/** Una jaula que toca la unidad: sus celdas dentro y fuera. */
interface Piece {
  readonly sum: number;
  readonly inside: readonly number[];
  readonly outside: readonly number[];
}

function piecesOf(context: GraderContext, unit: readonly number[]): Piece[] {
  const inUnit = new Set(unit);
  const cages = [...new Set(unit.map((cell) => at(context.cageOf, cell)))];
  return cages.map((index) => {
    const { cells, sum } = at(context.cages, index);
    return {
      sum,
      inside: cells.filter((cell) => inUnit.has(cell)),
      outside: cells.filter((cell) => !inUnit.has(cell)),
    };
  });
}

/** Jaulas con alguna celda vacía dentro de la unidad. */
function openCages(state: GraderState, pieces: readonly Piece[]): number {
  return pieces.filter(({ inside }) => inside.some((cell) => at(state.values, cell) === 0)).length;
}

/**
 * `unitSupport` con memoria, como `cachedSumSupport`: el resultado depende de los candidatos de la
 * unidad y de las celdas de fuera de sus jaulas. Devuelve `null` si la unidad tiene más de
 * `maxCombinations` combinaciones. La memoria guarda el conteo y, si se calculó, el soporte.
 */
function cachedUnitSupport(
  context: GraderContext,
  candidates: Uint16Array,
  index: number,
  pieces: readonly Piece[],
  maxCombinations: number,
): readonly number[] | null {
  const unit = at(context.units, index);
  const watched = [...unit, ...pieces.flatMap((piece) => piece.outside)];
  const cached = context.unitCache[index];
  const entry =
    cached && watched.every((cell, i) => at(candidates, cell) === at(cached.masks, i))
      ? cached
      : {
          masks: watched.map((cell) => at(candidates, cell)),
          ...countUnit(context.full, candidates, pieces),
        };
  context.unitCache[index] = entry;
  if (entry.combinations > maxCombinations) return null;
  entry.support ??= unitSupport(context, unit, pieces, entry);
  return entry.support;
}

/**
 * Pasada hacia adelante: para cada jaula, las formas de llenar sus celdas de dentro agrupadas por
 * el conjunto de dígitos que usan; y, tras cada jaula, cuántas combinaciones parciales llegan a
 * cada conjunto de dígitos usados. Las combinaciones de la unidad son las que llegan a todos.
 */
function countUnit(
  full: number,
  candidates: Uint16Array,
  pieces: readonly Piece[],
): Pick<UnitCacheEntry, "options" | "reach" | "combinations"> {
  const options = pieces.map((piece) => pieceOptions(candidates, piece));
  const reach: Map<number, number>[] = [new Map([[0, 1]])];
  options.forEach((byDigits, p) => {
    const next = new Map<number, number>();
    for (const [used, count] of at(reach, p)) {
      for (const digits of byDigits.keys()) {
        if ((used & digits) === 0) next.set(used | digits, (next.get(used | digits) ?? 0) + count);
      }
    }
    reach.push(next);
  });
  return { options, reach, combinations: at(reach, pieces.length).get(full) ?? 0 };
}

/**
 * Filtro exacto de la unidad, pasada hacia atrás: desde el conjunto completo, los conjuntos de
 * dígitos que todavía llegan a usar todos. Un conjunto de una jaula vale si une un estado
 * alcanzable con uno que termina, y sus formas dan el soporte. Devuelve el soporte de cada celda,
 * en el orden de `unit`.
 */
function unitSupport(
  context: GraderContext,
  unit: readonly number[],
  pieces: readonly Piece[],
  { options, reach }: Pick<UnitCacheEntry, "options" | "reach">,
): number[] {
  const support = new Array<number>(unit.length).fill(0);
  let finishing = new Set(at(reach, pieces.length).has(context.full) ? [context.full] : []);
  for (let p = pieces.length - 1; p >= 0; p--) {
    const before = new Set<number>();
    const piece = at(pieces, p);
    for (const [digits, cells] of at(options, p)) {
      let valid = false;
      for (const used of at(reach, p).keys()) {
        if ((used & digits) !== 0 || !finishing.has(used | digits)) continue;
        before.add(used);
        valid = true;
      }
      if (!valid) continue;
      piece.inside.forEach((cell, i) => {
        const index = unit.indexOf(cell);
        support[index] = at(support, index) | at(cells, i);
      });
    }
    finishing = before;
  }
  return support;
}

/**
 * Formas de llenar las celdas de la jaula dentro de la unidad: por conjunto de dígitos usados, los
 * candidatos de cada celda de dentro (en el orden de `inside`) que aparecen en alguna.
 */
function pieceOptions(candidates: Uint16Array, piece: Piece): Map<number, number[]> {
  const { inside, outside } = piece;
  const low = (cell: number): number => {
    const mask = at(candidates, cell);
    return 32 - Math.clz32(mask & -mask);
  };
  const high = (cell: number): number => 32 - Math.clz32(at(candidates, cell));
  // Cotas (sin exigir dígitos distintos) de lo que falta sumar después de cada celda de dentro.
  const rest = [...inside, ...outside];
  const minAfter = inside.map((_, i) => rest.slice(i + 1).reduce((s, c) => s + low(c), 0));
  const maxAfter = inside.map((_, i) => rest.slice(i + 1).reduce((s, c) => s + high(c), 0));

  // ¿Se completa la jaula fuera con lo que falta, sin los dígitos de dentro? Depende solo de ellos.
  const completes = new Map<number, boolean>();
  const fill = (depth: number, taken: number, left: number): boolean => {
    if (depth === outside.length) return left === 0;
    for (const digit of digitsOf(at(candidates, at(outside, depth)) & ~taken)) {
      if (digit > left) break;
      if (fill(depth + 1, taken | digitBit(digit), left - digit)) return true;
    }
    return false;
  };

  const options = new Map<number, number[]>();
  const assigned = new Array<number>(inside.length).fill(0);
  const visit = (depth: number, used: number, left: number): void => {
    if (depth === inside.length) {
      let ok = completes.get(used);
      if (ok === undefined) {
        ok = fill(0, used, left);
        completes.set(used, ok);
      }
      if (!ok) return;
      const cells = options.get(used) ?? new Array<number>(inside.length).fill(0);
      assigned.forEach((digit, i) => {
        cells[i] = at(cells, i) | digitBit(digit);
      });
      options.set(used, cells);
      return;
    }
    for (const digit of digitsOf(at(candidates, at(inside, depth)) & ~used)) {
      const after = left - digit;
      if (after < at(minAfter, depth)) break;
      if (after > at(maxAfter, depth)) continue;
      assigned[depth] = digit;
      visit(depth + 1, used | digitBit(digit), after);
    }
  };
  visit(0, 0, piece.sum);
  return options;
}
