// Cotas de `unitCombination` (F5): califica el corpus con la técnica completa de F4f y con cada
// cota, y mide cuántos puzzles de nivel 5 conserva cada una, cuántos pasan a exceder las técnicas,
// la tasa de nivel 5 por candidato, los minutos estimados para 500 y los tiempos de `grade` y
// `levelToDeduce`. Con la cota de `TECHNIQUES`, imprime los histogramas para la equivalencia entre
// niveles y dificultades (`docs/dificultad.md`). Comprueba que una cota solo pasa puzzles de nivel 5
// a exceder las técnicas y nunca cambia los demás (T-35.4: la cota solo quita deducciones).
// No corre en la CI de cada push: `pnpm test:corpus`.
import { describe, expect, it } from "vitest";
import {
  TECHNIQUES,
  UNBOUNDED,
  UNIT_COMBINATION_BOUND,
  UNRATED,
  generatePuzzle,
  grade,
  unitCombinationWithin,
  type GeneratedPuzzle,
  type GradeResult,
  type KillerPuzzle,
  type Technique,
  type UnitCombinationBound,
} from "@sudoku-killer/engine";
import { at } from "../src/model/at.ts";
import { levelToDeduceWith } from "../src/grader/grade.ts";
import { countsOf, mean, simulateGame, spread, summary } from "./helpers/corpus-stats.ts";

const BASE_SEED = Number(process.env["CORPUS_BASE_SEED"] ?? 1);
const SIZE = Number(process.env["CORPUS_SIZE"] ?? 1000);
/** Puzzles en los que se simula una partida para medir `levelToDeduce` con cada cota. */
const GAMES = Math.min(SIZE, 100);
/** Puzzles por dificultad del banco (criterio de aceptación de F5). */
const TARGET = 500;

const name = ({ maxOpenCages, maxCombinations }: UnitCombinationBound): string =>
  maxOpenCages === Infinity ? "full" : `${String(maxOpenCages)}/${String(maxCombinations)}`;

const BOUNDS: readonly UnitCombinationBound[] = [
  UNBOUNDED,
  { maxOpenCages: 4, maxCombinations: 8 },
  { maxOpenCages: 5, maxCombinations: 16 },
  { maxOpenCages: 5, maxCombinations: 32 },
];

/** `TECHNIQUES` con otra cota de `unitCombination`. */
const techniquesWith = (bound: UnitCombinationBound): readonly Technique[] =>
  TECHNIQUES.map((technique) =>
    technique.id === "unitCombination" ? unitCombinationWithin(bound) : technique,
  );

/** Copia del puzzle, para que cada cota empiece sin la memoria del contexto de otra. */
const fresh = (puzzle: KillerPuzzle): KillerPuzzle => structuredClone(puzzle);

const levelKey = (result: GradeResult): string =>
  result.status === "solved" ? `level ${String(result.maxLevel)}` : result.status;

const minutesFor = (rate: number, msPerCandidate: number): string =>
  rate === 0 ? "never" : `${(((TARGET / rate) * msPerCandidate) / 60_000).toFixed(1)} min`;

interface BoundRun {
  readonly bound: UnitCombinationBound;
  readonly techniques: readonly Technique[];
  readonly results: GradeResult[];
  readonly gradeTimes: number[];
  readonly levelTimes: number[];
  readonly levels: Map<number, number>;
}

/** Propuesta de equivalencia (punto de control de F5a): `null` si el puzzle se excluye. */
function proposedDifficulty(result: GradeResult): string | null {
  if (result.status !== "solved") return null;
  const levelThreeSteps = at(result.stepsByLevel, 3);
  if (result.maxLevel <= 2) return "easy";
  if (result.maxLevel === 3) return levelThreeSteps === 1 ? "medium" : "hard";
  if (result.maxLevel === 4) return "hard";
  return "expert";
}

describe("unitCombination bounds", () => {
  it(
    `${String(SIZE)} puzzles from seed ${String(BASE_SEED)}: a bound only turns level 5 into exceeding`,
    { timeout: 3_600_000 },
    () => {
      const generated: GeneratedPuzzle[] = [];
      const generateTimes: number[] = [];
      const runs: BoundRun[] = BOUNDS.map((bound) => ({
        bound,
        techniques: techniquesWith(bound),
        results: [],
        gradeTimes: [],
        levelTimes: [],
        levels: new Map(),
      }));

      for (let seed = BASE_SEED; seed < BASE_SEED + SIZE; seed++) {
        const start = performance.now();
        const puzzle = generatePuzzle({ seed });
        generateTimes.push(performance.now() - start);
        generated.push(puzzle);
        for (const run of runs) {
          const copy = fresh(puzzle.puzzle);
          const begin = performance.now();
          run.results.push(grade(copy, { techniques: run.techniques }));
          run.gradeTimes.push(performance.now() - begin);
          if (seed >= BASE_SEED + GAMES) continue;
          const game = fresh(puzzle.puzzle);
          simulateGame(puzzle, seed, (cell, values) => {
            const t = performance.now();
            const level = levelToDeduceWith(run.techniques, cell, { puzzle: game, values });
            run.levelTimes.push(performance.now() - t);
            expect(level).toBeGreaterThanOrEqual(1);
            expect(level).toBeLessThanOrEqual(UNRATED);
            run.levels.set(level, (run.levels.get(level) ?? 0) + 1);
          });
        }
      }

      const [full] = runs;
      if (!full) throw new Error("No full run");
      const fullFive = full.results.filter((r) => r.status === "solved" && r.maxLevel === 5);
      const generateMean = mean(generateTimes);
      const lines = [
        `unitCombination bounds: ${String(SIZE)} puzzles 9x9, seeds ${String(BASE_SEED)} to ${String(BASE_SEED + SIZE - 1)}; generatePuzzle ${summary(generateTimes)}`,
        `Bound (open cages/combinations): level 5 kept of ${String(fullFive.length)} / turned exceeding / level-5 rate / minutes for ${String(TARGET)} / grade / levelToDeduce`,
      ];
      for (const run of runs) {
        let kept = 0;
        let turned = 0;
        run.results.forEach((result, i) => {
          const reference = at(full.results, i);
          const seed = BASE_SEED + i;
          if (reference.status === "solved" && reference.maxLevel === 5) {
            // Nivel 5 con la técnica completa: con la cota, nivel 5 o excede (nunca menos).
            if (result.status === "solved") {
              expect(result.maxLevel, `seed ${String(seed)}`).toBe(5);
              kept++;
            } else {
              expect(result.status, `seed ${String(seed)}`).toBe("exceedsTechniques");
              turned++;
            }
          } else {
            // Los niveles 1 a 4 no llegan a `unitCombination`: misma traza. Lo que excede sigue
            // excediendo, con los mismos pasos o menos.
            expect(levelKey(result), `seed ${String(seed)}`).toBe(levelKey(reference));
            if (result.status === "solved") {
              expect(result.steps, `seed ${String(seed)}`).toBe(reference.steps);
            }
          }
        });
        const rate = kept / SIZE;
        const msPerCandidate = generateMean + mean(run.gradeTimes);
        lines.push(
          `  ${name(run.bound)}: ${String(kept)} / ${String(turned)} / ${(100 * rate).toFixed(1)}% / ${minutesFor(rate, msPerCandidate)} (at ${msPerCandidate.toFixed(1)} ms per candidate)`,
          `    grade: ${summary(run.gradeTimes)}`,
          `    levelToDeduce (${String(run.levelTimes.length)} calls in ${String(GAMES)} games): ${summary(run.levelTimes, 2)}; results ${[
            ...run.levels,
          ]
            .sort(([a], [b]) => a - b)
            .map(([level, count]) => `${String(level)}: ${String(count)}`)
            .join(", ")}`,
        );
      }

      // Histogramas para la equivalencia, con la cota de `TECHNIQUES`.
      const chosen = runs.find(
        ({ bound }) =>
          bound.maxOpenCages === UNIT_COMBINATION_BOUND.maxOpenCages &&
          bound.maxCombinations === UNIT_COMBINATION_BOUND.maxCombinations,
      );
      if (!chosen) throw new Error("UNIT_COMBINATION_BOUND is not among the measured bounds");
      const byLevel = new Map<string, GradeResult[]>();
      const levelThreeDeductions = new Map<GradeResult, number>();
      chosen.results.forEach((result, i) => {
        const key = levelKey(result);
        byLevel.set(key, [...(byLevel.get(key) ?? []), result]);
        const traced = grade(fresh(at(generated, i).puzzle), {
          techniques: chosen.techniques,
          trace: true,
        });
        expect(traced.steps).toBe(result.steps);
        levelThreeDeductions.set(
          result,
          (traced.trace ?? [])
            .filter((step) => step.level === 3)
            .reduce((total, step) => total + step.deductions.length, 0),
        );
      });
      lines.push(`Histograms with bound ${name(chosen.bound)}:`);
      for (const [key, results] of [...byLevel].sort(([a], [b]) => a.localeCompare(b))) {
        const threeSteps = new Map<string, number>();
        for (const result of results) {
          const steps = Math.min(at(result.stepsByLevel, 3), 6);
          const label = steps === 6 ? "6+" : String(steps);
          threeSteps.set(label, (threeSteps.get(label) ?? 0) + 1);
        }
        lines.push(
          `  ${key} (${String(results.length)}): steps ${spread(results.map((r) => r.steps))}; level-3 steps ${countsOf(threeSteps)}; level-3 deductions ${spread(results.map((r) => levelThreeDeductions.get(r) ?? 0))}`,
        );
      }

      const byDifficulty = new Map<string, GradeResult[]>();
      for (const result of chosen.results) {
        const difficulty = proposedDifficulty(result) ?? "excluded";
        byDifficulty.set(difficulty, [...(byDifficulty.get(difficulty) ?? []), result]);
      }
      const msPerCandidate = generateMean + mean(chosen.gradeTimes);
      lines.push(
        `Excluded (exceeding the techniques): ${String(byDifficulty.get("excluded")?.length ?? 0)}`,
      );
      lines.push(
        "Proposed difficulties (share / candidates and minutes for 500 / steps / level-3 deductions):",
      );
      for (const difficulty of ["easy", "medium", "hard", "expert"]) {
        const results = byDifficulty.get(difficulty) ?? [];
        const rate = results.length / SIZE;
        lines.push(
          `  ${difficulty} (${String(results.length)}): ${(100 * rate).toFixed(1)}% / ${rate === 0 ? "never" : String(Math.ceil(TARGET / rate))} candidates, ${minutesFor(rate, msPerCandidate)} / steps ${spread(results.map((r) => r.steps))} / ${spread(results.map((r) => levelThreeDeductions.get(r) ?? 0))}`,
        );
      }
      console.log(lines.join("\n"));
    },
  );
});
