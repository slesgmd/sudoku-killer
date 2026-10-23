import type { Grid, KillerPuzzle } from "../types.ts";
import { popcount, singleDigit } from "../model/mask.ts";
import { buildContext, type Context } from "./context.ts";
import { propagate } from "./propagate.ts";

export interface SolveAOptions {
  /** Soluciones a buscar antes de detenerse (por defecto 2: basta para saber si es única). */
  readonly limit?: number;
  /**
   * Presupuesto de nodos (por defecto, sin límite). Si la búsqueda lo agota, se detiene con
   * `exhausted` en true: `count` y `solutions` son entonces lo encontrado hasta ahí, no el total.
   * Es de nodos y no de tiempo porque el motor no lee el reloj; lo usa el generador (F4d).
   */
  readonly maxNodes?: number;
}

export interface SolveAResult {
  /** 0 sin solución, 1 con una sola y 2 con dos o más (o con una, si `limit` es 1). */
  readonly count: 0 | 1 | 2;
  /** Las soluciones encontradas, como mucho `limit`, en el orden de la búsqueda. */
  readonly solutions: readonly Grid[];
  /** Nodos de búsqueda: estados propagados, incluida la raíz. Nunca pasa de `maxNodes`. */
  readonly nodes: number;
  /** true si la búsqueda se detuvo por `maxNodes` antes de terminar. */
  readonly exhausted: boolean;
}

interface Run {
  readonly ctx: Context;
  readonly limit: number;
  readonly maxNodes: number;
  readonly solutions: Grid[];
  nodes: number;
  exhausted: boolean;
}

function search(run: Run, cand: Uint16Array, placed: Uint8Array, dirty: Uint8Array): void {
  if (run.nodes >= run.maxNodes) {
    run.exhausted = true;
    return;
  }
  run.nodes++;
  if (!propagate(run.ctx, cand, placed, dirty)) return;

  // dom/wdeg: la celda sin resolver con menos candidatos por unidad de peso. El peso crece con los
  // fallos en que participa la celda; al principio todos valen 1, así que empieza como MRV.
  // Ante un empate, la de menor índice.
  const { weights } = run.ctx;
  let best = -1;
  let bestScore = Infinity;
  for (let cell = 0; cell < cand.length; cell++) {
    const count = popcount(cand[cell]!);
    if (count < 2) continue;
    const score = count / weights[cell]!;
    if (score < bestScore) {
      best = cell;
      bestScore = score;
    }
  }
  if (best === -1) {
    run.solutions.push(Array.from(cand, (mask) => singleDigit(mask)));
    return;
  }

  for (
    let m = cand[best]!;
    m !== 0 && run.solutions.length < run.limit && !run.exhausted;
    m &= m - 1
  ) {
    const next = cand.slice();
    next[best] = m & -m;
    const nextDirty = new Uint8Array(dirty.length);
    for (const group of run.ctx.groupsOf[best]!) nextDirty[group] = 1;
    search(run, next, placed.slice(), nextDirty);
  }
}

/**
 * Solver A (SPEC R-35): propagación de restricciones y backtracking con MRV ponderado por fallos
 * (dom/wdeg). Cuenta soluciones y se detiene al llegar a `limit` o al agotar `maxNodes`. Exige una estructura válida
 * (`validateStructure`); si no, lanza un `RangeError`. Determinista: los pesos dependen solo del
 * puzzle, los dígitos se prueban de menor a mayor y los empates se resuelven por índice.
 */
export function solveA(puzzle: KillerPuzzle, options: SolveAOptions = {}): SolveAResult {
  const limit = options.limit ?? 2;
  if (!(Number.isInteger(limit) || limit === Infinity) || limit < 1) {
    throw new RangeError(`Invalid limit ${String(limit)}`);
  }
  const maxNodes = options.maxNodes ?? Infinity;
  if (!(Number.isInteger(maxNodes) || maxNodes === Infinity) || maxNodes < 1) {
    throw new RangeError(`Invalid node budget ${String(maxNodes)}`);
  }
  const ctx = buildContext(puzzle);
  const run: Run = { ctx, limit, maxNodes, solutions: [], nodes: 0, exhausted: false };
  const dirty = new Uint8Array(ctx.groups.length).fill(1);
  search(run, ctx.initial.slice(), new Uint8Array(ctx.cellCount), dirty);

  const found = run.solutions.length;
  return {
    count: found === 0 ? 0 : found === 1 ? 1 : 2,
    solutions: run.solutions,
    nodes: run.nodes,
    exhausted: run.exhausted,
  };
}
