// Resúmenes de los corpus del calificador: cuantiles, tiempos, conteos y partidas
// simuladas para medir `levelToDeduce` como lo hará el servidor.
import { createRng, type GeneratedPuzzle } from "@sudoku-killer/engine";
import { at } from "../../src/model/at.ts";

export function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN;
}

export function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Media, mediana, p95, p99 y máximo de tiempos en milisegundos. */
export function summary(values: readonly number[], digits = 1): string {
  const sorted = [...values].sort((a, b) => a - b);
  const ms = (value: number): string => `${value.toFixed(digits)} ms`;
  return `mean ${ms(mean(values))}, median ${ms(quantile(sorted, 0.5))}, p95 ${ms(quantile(sorted, 0.95))}, p99 ${ms(quantile(sorted, 0.99))}, max ${ms(sorted.at(-1) ?? NaN)}`;
}

/** Mediana, p95 y máximo de una lista de enteros. */
export function spread(values: readonly number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  return `median ${String(quantile(sorted, 0.5))}, p95 ${String(quantile(sorted, 0.95))}, max ${String(sorted.at(-1))}`;
}

export const countsOf = (counts: Map<string, number>): string =>
  [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `${key}: ${String(count)}`)
    .join(", ");

/**
 * Partida simulada: las celdas vacías se llenan con la solución en un orden aleatorio (con
 * semilla), y antes de cada jugada se llama a `measure` con la celda y los dígitos colocados, como
 * hará el servidor con `levelToDeduce`.
 */
export function simulateGame(
  { puzzle, solution }: GeneratedPuzzle,
  seed: number,
  measure: (cell: number, values: readonly number[]) => void,
): void {
  const values = new Array<number>(solution.length).fill(0);
  for (const { cell, value } of puzzle.givens) values[cell] = value;
  const order = values.flatMap((value, cell) => (value === 0 ? [cell] : []));
  const rng = createRng(seed);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [at(order, j), at(order, i)];
  }
  for (const cell of order) {
    measure(cell, values);
    values[cell] = at(solution, cell);
  }
}
