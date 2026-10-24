// Corpus del calificador (F4e y F4f, T-35.4 y T-35.5): califica los puzzles 9×9 del corpus del generador
// y comprueba cada deducción contra la solución única. Una deducción que la contradiga bloquea F4.
// Imprime la distribución de niveles y el informe por técnica (datos para F5), el tiempo de `grade` y
// de `levelToDeduce`, y comprueba la monotonía de `levelToDeduce` en 9000 comparaciones.
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
  type GradeResult,
  type TechniqueId,
} from "@sudoku-killer/engine";
import { at } from "../src/model/at.ts";
import { expectMonotoneLevels, expectSoundGrade } from "./helpers/grader.ts";
import {
  gradeWithout,
  replayTrace,
  unitCombinationCosts,
  type UnitCost,
} from "./helpers/grader-report.ts";

const BASE_SEED = Number(process.env["CORPUS_BASE_SEED"] ?? 1);
const SIZE = Number(process.env["CORPUS_SIZE"] ?? 1000);
/** Puzzles en los que se simula una partida para medir `levelToDeduce`. */
const GAMES = Math.min(SIZE, 100);
/** Monotonía (T-35.5): 200 puzzles × 3 celdas × 15 tandas de 4 celdas = 9000 comparaciones. */
const MONOTONY_PUZZLES = Math.min(SIZE, 200);
const MONOTONY = { targets: 3, batches: 15, batchSize: 4 } as const;

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN;
}

function summary(values: readonly number[], digits = 1): string {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const ms = (value: number): string => `${value.toFixed(digits)} ms`;
  return `mean ${ms(mean)}, median ${ms(quantile(sorted, 0.5))}, p95 ${ms(quantile(sorted, 0.95))}, p99 ${ms(quantile(sorted, 0.99))}, max ${ms(sorted.at(-1) ?? NaN)}`;
}

/** Mediana, p95 y máximo de una lista de enteros. */
function spread(values: readonly number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  return `median ${String(quantile(sorted, 0.5))}, p95 ${String(quantile(sorted, 0.95))}, max ${String(sorted.at(-1))}`;
}

const countsOf = (counts: Map<string, number>): string =>
  [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `${key}: ${String(count)}`)
    .join(", ");

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

/** Uso de una técnica en el corpus. */
interface TechniqueUse {
  puzzles: number;
  steps: number;
  deductions: number;
}

/** Un puzzle de nivel máximo 5, con el costo de cada deducción de `unitCombination` de su traza. */
interface LevelFivePuzzle {
  readonly generated: GeneratedPuzzle;
  readonly result: GradeResult;
  readonly costs: readonly UnitCost[];
}

/**
 * Informe de `unitCombination` para F5, sin cambiar el calificador: qué pasa con los puzzles de
 * nivel 5 si se desactiva, el tamaño de la unidad que justifica cada deducción y cuántas
 * deducciones y puzzles quedan dentro de cada cota de jaulas y de combinaciones.
 */
function unitCombinationReport(
  costs: readonly UnitCost[],
  levelFive: readonly LevelFivePuzzle[],
): string[] {
  const withoutIt = new Map<string, number>();
  for (const { generated, result, costs: own } of levelFive) {
    const other = gradeWithout(generated.puzzle, "unitCombination");
    // Sin `unitCombination` en su traza, la réplica del bucle tiene que dar lo mismo que `grade`.
    if (own.length === 0) {
      expect(other).toEqual({ status: result.status, maxLevel: result.maxLevel });
    }
    const key = other.status === "solved" ? `level ${String(other.maxLevel)}` : other.status;
    withoutIt.set(key, (withoutIt.get(key) ?? 0) + 1);
  }
  const using = levelFive.filter(({ costs: own }) => own.length > 0).length;

  const maxCages = Math.max(...costs.map(({ open }) => open));
  const cageBounds = [...Array<number>(maxCages).keys()].map((i) => i + 1);
  const comboBounds = [1, 2, 4, 8, 16, 32, Infinity];
  const label = (bound: number): string => (bound === Infinity ? "any" : `<=${String(bound)}`);
  const within = (cost: UnitCost, cages: number, combos: number): boolean =>
    cost.open <= cages && cost.combinations <= combos;
  const percent = (part: number, total: number): string => `${((100 * part) / total).toFixed(1)}%`;
  const table = (title: string, cell: (cages: number, combos: number) => string): string[] => [
    `${title} (rows: open cages; columns: combinations ${comboBounds.map(label).join(" / ")})`,
    ...cageBounds.map(
      (cages) =>
        `  open cages ${label(cages)}: ${comboBounds.map((combos) => cell(cages, combos)).join(" / ")}`,
    ),
  ];

  return [
    `unitCombination: used in ${String(using)} of ${String(levelFive.length)} level-5 puzzles; without it: ${countsOf(withoutIt)}`,
    `unitCombination deductions (${String(costs.length)}), smallest justifying unit: cages ${spread(costs.map(({ cages }) => cages))}; open cages ${spread(costs.map(({ open }) => open))}; protruding cages ${spread(costs.map(({ protruding }) => protruding))}; combinations ${spread(costs.map(({ combinations }) => combinations))}`,
    ...table("Share of unitCombination deductions within the bounds", (cages, combos) =>
      percent(costs.filter((cost) => within(cost, cages, combos)).length, costs.length),
    ),
    ...table(
      "Level-5 puzzles whose every unitCombination deduction is within the bounds (lower bound of those a bounded variant keeps)",
      (cages, combos) =>
        String(
          levelFive.filter(({ costs: own }) => own.every((cost) => within(cost, cages, combos)))
            .length,
        ),
    ),
  ];
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
      const byTechnique = new Map<TechniqueId, TechniqueUse>(
        TECHNIQUES.map(({ id }) => [id, { puzzles: 0, steps: 0, deductions: 0 }]),
      );
      const unitCosts: UnitCost[] = [];
      const levelFive: LevelFivePuzzle[] = [];
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
          const used = new Set<TechniqueId>();
          const costs: UnitCost[] = [];
          replayTrace(puzzle, traced.trace ?? [], (state, step) => {
            deductions += step.deductions.length;
            const use = byTechnique.get(step.technique);
            if (use) {
              use.steps++;
              use.deductions += step.deductions.length;
            }
            used.add(step.technique);
            if (step.technique === "unitCombination") {
              costs.push(...unitCombinationCosts(puzzle, state, step));
            }
          });
          for (const id of used) {
            const use = byTechnique.get(id);
            if (use) use.puzzles++;
          }
          unitCosts.push(...costs);
          if (result.status === "solved" && result.maxLevel === 5) {
            levelFive.push({ generated, result, costs });
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
      const levelCounts = [...levels].sort(([a], [b]) => a - b);
      console.log(
        [
          `Grader corpus: ${String(SIZE)} puzzles 9x9, seeds ${String(BASE_SEED)} to ${String(BASE_SEED + SIZE - 1)}, ${String(deductions)} deductions, 0 against the solution`,
          `Max level: ${countsOf(byLevel)}`,
          `Steps per puzzle: median ${String(quantile(sortedSteps, 0.5))}, max ${String(sortedSteps.at(-1))}; steps by level 1-${String(MAX_TECHNIQUE_LEVEL)}: ${stepsByLevel.slice(1).join(" / ")}`,
          "By technique (level: puzzles using it / steps / deductions):",
          ...TECHNIQUES.map(({ id, level }) => {
            const use = byTechnique.get(id);
            return `  ${id} (${String(level)}): ${String(use?.puzzles)} / ${String(use?.steps)} / ${String(use?.deductions)}`;
          }),
          ...unitCombinationReport(unitCosts, levelFive),
          `grade: ${summary(gradeTimes)}`,
          `levelToDeduce (${String(levelTimes.length)} calls in ${String(GAMES)} simulated games): ${summary(levelTimes, 2)}`,
          `levelToDeduce results: ${levelCounts.map(([level, count]) => `${String(level)}: ${String(count)}`).join(", ")}`,
        ].join("\n"),
      );
    },
  );

  it(
    `T-35.5: levelToDeduce never rises in ${String(MONOTONY_PUZZLES)} puzzles from seed ${String(BASE_SEED)}`,
    { timeout: 1_800_000 },
    () => {
      let comparisons = 0;
      const levels = new Map<number, number>();
      for (let seed = BASE_SEED; seed < BASE_SEED + MONOTONY_PUZZLES; seed++) {
        const result = expectMonotoneLevels(generatePuzzle({ seed }), seed, MONOTONY);
        comparisons += result.comparisons;
        for (const level of result.levels) levels.set(level, (levels.get(level) ?? 0) + 1);
      }
      expect(comparisons).toBe(MONOTONY_PUZZLES * MONOTONY.targets * MONOTONY.batches);
      const measured = [...levels]
        .sort(([a], [b]) => a - b)
        .map(([level, count]) => `${String(level)}: ${String(count)}`)
        .join(", ");
      console.log(
        `levelToDeduce monotony: ${String(comparisons)} comparisons in ${String(MONOTONY_PUZZLES)} puzzles, none rises; levels measured: ${measured}`,
      );
    },
  );
});
