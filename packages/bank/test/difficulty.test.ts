// T-20.3: reglas de cada dificultad, versión 2 (docs/dificultad.md): números iniciales, piso de la
// guarda y banda de niveles, sin solaparse; y cada semilla pertenece a una sola dificultad.
import { UNRATED, type GradeResult } from "@sudoku-killer/engine";
import { DIFFICULTIES } from "@sudoku-killer/protocol";
import { describe, expect, it } from "vitest";
import { DIFFICULTY_MAPPING_VERSION, DIFFICULTY_RULES, difficultyOfSeed } from "../src/index.ts";

/** Resultado de `grade` con los pasos de los niveles 1 a 5. */
function result(steps: readonly number[], status: GradeResult["status"] = "solved"): GradeResult {
  const stepsByLevel = [0, ...steps, 0, 0, 0, 0, 0].slice(0, 6);
  const used = stepsByLevel.flatMap((count, level) => (count > 0 ? [level] : []));
  return {
    status,
    maxLevel: status === "solved" ? Math.max(1, ...used) : UNRATED,
    steps: stepsByLevel.reduce((a, b) => a + b, 0),
    stepsByLevel,
    unplaced: status === "solved" ? 0 : 10,
  };
}

const SAMPLES: readonly (readonly [string, GradeResult])[] = [
  ["only singles", result([30])],
  ["cage combinations", result([30, 8])],
  ["one level-3 step", result([30, 8, 1])],
  ["many level-3 steps", result([30, 8, 7])],
  ["level 4 with level 3", result([30, 8, 1, 1])],
  ["level 4 without level 3", result([30, 8, 0, 2])],
  ["level 5", result([30, 8, 1, 0, 1])],
  ["exceeds", result([10, 5, 3, 1, 1], "exceedsTechniques")],
  ["contradiction", result([10], "contradiction")],
];

describe("T-20.3 difficulty rules (mapping version 2)", () => {
  it("is version 2, with 30, 22, 10 and 0 givens", () => {
    expect(DIFFICULTY_MAPPING_VERSION).toBe("2");
    expect(DIFFICULTIES.map((d) => DIFFICULTY_RULES[d].givens)).toEqual([30, 22, 10, 0]);
  });

  it.each([
    ["only singles", "easy"],
    ["cage combinations", "medium"],
    ["one level-3 step", "hard"],
    ["many level-3 steps", "hard"],
    ["level 4 with level 3", "hard"],
    ["level 5", "expert"],
  ] as const)("%s fits only %s", (name, expected) => {
    const sample = SAMPLES.find(([n]) => n === name)?.[1];
    if (!sample) throw new Error(name);
    const fits = DIFFICULTIES.filter((d) => DIFFICULTY_RULES[d].accepts(sample));
    expect(fits).toEqual([expected]);
  });

  it("no band takes a level-4 puzzle without level 3, one that exceeds or one without solution", () => {
    for (const name of ["level 4 without level 3", "exceeds", "contradiction"]) {
      const sample = SAMPLES.find(([n]) => n === name)?.[1];
      if (!sample) throw new Error(name);
      expect(
        DIFFICULTIES.filter((d) => DIFFICULTY_RULES[d].accepts(sample)),
        name,
      ).toEqual([]);
    }
  });

  it("every accepted puzzle meets its guard floor, and the floor never blocks an unsolved puzzle", () => {
    for (const [name, sample] of SAMPLES) {
      for (const d of DIFFICULTIES) {
        const rule = DIFFICULTY_RULES[d];
        if (rule.accepts(sample)) expect(rule.floor(sample), `${d} ${name}`).toBe(true);
        if (sample.status !== "solved") expect(rule.floor(sample), `${d} ${name}`).toBe(true);
      }
    }
  });

  it("each seed belongs to one difficulty, in turn", () => {
    expect([0, 1, 2, 3, 4, 5].map(difficultyOfSeed)).toEqual([
      "easy",
      "medium",
      "hard",
      "expert",
      "easy",
      "medium",
    ]);
  });
});
