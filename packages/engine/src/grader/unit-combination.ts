// Nivel 5: combinaciones de una unidad entera con sus jaulas. Generaliza la regla del 45 y las
// combinaciones de jaula: una fila, columna o caja usa cada dígito una vez, y las jaulas que la
// tocan tienen que cuadrar a la vez.
import { at } from "../model/at.ts";
import { digitBit, digitsOf, popcount } from "../model/mask.ts";
import type { GraderContext } from "./context.ts";
import { eliminationCollector } from "./subsets.ts";
import type { Technique } from "./types.ts";

/**
 * Combinaciones de unidad: un candidato de una celda de la unidad que no aparece en ninguna forma
 * de llenarla con todos sus dígitos, en la que cada jaula que la toca cuadre, sale de la celda. Una
 * jaula entera dentro de la unidad tiene que sumar justo; una que sobresale, poder completarse
 * fuera con sus candidatos, sin repetir dígito en la jaula.
 */
export const unitCombination: Technique = {
  id: "unitCombination",
  level: 5,
  find: (context, state) => {
    const { deductions, eliminate } = eliminationCollector(state);
    context.units.forEach((unit, index) => {
      if (unit.every((cell) => popcount(at(state.candidates, cell)) === 1)) return;
      const support = cachedUnitSupport(context, state.candidates, index);
      unit.forEach((cell, i) => {
        if (at(state.values, cell) === 0) eliminate(cell, ~at(support, i));
      });
    });
    return deductions;
  },
};

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

/**
 * `unitSupport` con memoria, como `cachedSumSupport`: el resultado depende de los candidatos de la
 * unidad y de las celdas de fuera de sus jaulas.
 */
function cachedUnitSupport(
  context: GraderContext,
  candidates: Uint16Array,
  index: number,
): number[] {
  const unit = at(context.units, index);
  const pieces = piecesOf(context, unit);
  const watched = [...unit, ...pieces.flatMap((piece) => piece.outside)];
  const entry = context.unitCache[index];
  if (entry && watched.every((cell, i) => at(candidates, cell) === at(entry.masks, i))) {
    return entry.support;
  }
  const support = unitSupport(context, candidates, unit, pieces);
  context.unitCache[index] = { masks: watched.map((cell) => at(candidates, cell)), support };
  return support;
}

/**
 * Filtro exacto de la unidad. Para cada jaula se enumeran las formas de llenar sus celdas de dentro
 * (sin repetir dígito y con la jaula completable fuera), agrupadas por el conjunto de dígitos que
 * usan. Después se combinan las jaulas sin repetir dígito: hacia adelante, los conjuntos de dígitos
 * alcanzables tras cada jaula; hacia atrás, los que todavía llegan a usar todos los dígitos. Un
 * conjunto de una jaula vale si une un estado alcanzable con uno que termina. Devuelve el soporte
 * de cada celda, en el orden de `unit`.
 */
function unitSupport(
  context: GraderContext,
  candidates: Uint16Array,
  unit: readonly number[],
  pieces: readonly Piece[],
): number[] {
  const options = pieces.map((piece) => pieceOptions(candidates, piece));

  const reach: Set<number>[] = [new Set([0])];
  options.forEach((byDigits, p) => {
    const next = new Set<number>();
    for (const used of at(reach, p)) {
      for (const digits of byDigits.keys()) if ((used & digits) === 0) next.add(used | digits);
    }
    reach.push(next);
  });

  const support = new Array<number>(unit.length).fill(0);
  let finishing = new Set(at(reach, pieces.length).has(context.full) ? [context.full] : []);
  for (let p = pieces.length - 1; p >= 0; p--) {
    const before = new Set<number>();
    const piece = at(pieces, p);
    for (const [digits, cells] of at(options, p)) {
      let valid = false;
      for (const used of at(reach, p)) {
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
