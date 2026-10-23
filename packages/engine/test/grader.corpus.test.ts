// Corpus del calificador (F4e y F4f, T-35.4 y T-35.5): califica los puzzles 9×9 del corpus del generador
// y comprueba cada deducción contra la solución única. Una deducción que la contradiga bloquea F4.
// Imprime la distribución de niveles (dato para F5) y el tiempo de `grade` y de `levelToDeduce`.
// No corre en la CI de cada push: `pnpm test:corpus` y el workflow programado `corpus.yml`.
// Semillas: de CORPUS_BASE_SEED (por defecto 1) en adelante; CORPUS_SIZE cambia la cantidad.
import { describe, expect, it } from "vitest";
import {
  MAX_TECHNIQUE_LEVEL,
  TECHNIQUES,
  UNRATED,
  createRng,
  generatePuzzle,
  grade,
  levelToDeduce,
  type GeneratedPuzzle,
} from "@sudoku-killer/engine";
import { at } from "../src/model/at.ts";
import { expectSoundGrade } from "./helpers/grader.ts";

const BASE_SEED = Number(process.env["CORPUS_BASE_SEED"] ?? 1);
const SIZE = Number(process.env["CORPUS_SIZE"] ?? 1000);
/** Puzzles en los que se simula una partida para medir `levelToDeduce`. */
const GAMES = Math.min(SIZE, 100);

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN;
}

function summary(values: readonly number[], digits = 1): string {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const ms = (value: number): string => `${value.toFixed(digits)} ms`;
  return `mean ${ms(mean)}, median ${ms(quantile(sorted, 0.5))}, p95 ${ms(quantile(sorted, 0.95))}, p99 ${ms(quantile(sorted, 0.99))}, max ${ms(sorted.at(-1) ?? NaN)}`;
}

/**
 * Partida simulada: las celdas vacías se llenan con la solución en un orden aleatorio (con
 * semilla), y antes de cada jugada se mide `levelToDeduce` como lo hará el servidor.
 */
function simulateGame(
  { puzzle, solution }: GeneratedPuzzle,
  seed: number,
  times: number[],
  levels: Map<number, number>,
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
    const start = performance.now();
    const level = levelToDeduce(cell, { puzzle, values });
    times.push(performance.now() - start);
    expect(level).toBeGreaterThanOrEqual(1);
    expect(level).toBeLessThanOrEqual(UNRATED);
    levels.set(level, (levels.get(level) ?? 0) + 1);
    values[cell] = at(solution, cell);
  }
}

describe("grader corpus", () => {
  it(
    `${String(SIZE)} puzzles from seed ${String(BASE_SEED)}: no deduction contradicts the solution`,
    { timeout: 1_800_000 },
    () => {
      expect(Number.isInteger(BASE_SEED) && BASE_SEED >= 0).toBe(true);
      const byLevel = new Map<string, number>();
      const steps: number[] = [];
      const stepsByLevel = new Array<number>(MAX_TECHNIQUE_LEVEL + 1).fill(0);
      const gradeTimes: number[] = [];
      const levelTimes: number[] = [];
      const levels = new Map<number, number>();
      const byTechnique = new Map<string, number>();
      let deductions = 0;

      for (let seed = BASE_SEED; seed < BASE_SEED + SIZE; seed++) {
        try {
          const generated = generatePuzzle({ seed });
          const { puzzle, solution } = generated;
          const start = performance.now();
          const result = grade(puzzle);
          gradeTimes.push(performance.now() - start);

          const traced = expectSoundGrade(puzzle, solution);
          expect({ ...traced, trace: undefined }).toEqual({ ...result, trace: undefined });
          for (const step of traced.trace ?? []) {
            deductions += step.deductions.length;
            byTechnique.set(step.technique, (byTechnique.get(step.technique) ?? 0) + 1);
          }
          const key =
            result.status === "solved" ? `level ${String(result.maxLevel)}` : result.status;
          byLevel.set(key, (byLevel.get(key) ?? 0) + 1);
          steps.push(result.steps);
          result.stepsByLevel.forEach((count, level) => {
            stepsByLevel[level] = (stepsByLevel[level] ?? 0) + count;
          });

          if (seed < BASE_SEED + GAMES) simulateGame(generated, seed, levelTimes, levels);
        } catch (error) {
          throw new Error(`Corpus seed ${String(seed)} failed (add it as a fixed case)`, {
            cause: error,
          });
        }
      }

      const sortedSteps = [...steps].sort((a, b) => a - b);
      const distribution = [...byLevel].sort(([a], [b]) => a.localeCompare(b));
      const levelCounts = [...levels].sort(([a], [b]) => a - b);
      console.log(
        [
          `Grader corpus: ${String(SIZE)} puzzles 9x9, seeds ${String(BASE_SEED)} to ${String(BASE_SEED + SIZE - 1)}, ${String(deductions)} deductions, 0 against the solution`,
          `Max level: ${distribution.map(([key, count]) => `${key}: ${String(count)}`).join(", ")}`,
          `Steps per puzzle: median ${String(quantile(sortedSteps, 0.5))}, max ${String(sortedSteps.at(-1))}; steps by level 1-${String(MAX_TECHNIQUE_LEVEL)}: ${stepsByLevel.slice(1).join(" / ")}`,
          `Steps by technique: ${TECHNIQUES.map(({ id }) => `${id} ${String(byTechnique.get(id) ?? 0)}`).join(", ")}`,
          `grade: ${summary(gradeTimes)}`,
          `levelToDeduce (${String(levelTimes.length)} calls in ${String(GAMES)} simulated games): ${summary(levelTimes, 2)}`,
          `levelToDeduce results: ${levelCounts.map(([level, count]) => `${String(level)}: ${String(count)}`).join(", ")}`,
        ].join("\n"),
      );
    },
  );
});
