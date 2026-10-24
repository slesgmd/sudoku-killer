// T-20.3: equivalencia entre niveles del calificador y dificultades (docs/dificultad.md, versión 1).
import { UNRATED, type GradeResult } from "@sudoku-killer/engine";
import { DIFFICULTIES } from "@sudoku-killer/protocol";
import { describe, expect, it } from "vitest";
import { DIFFICULTY_VALUES } from "../src/db/schema.ts";
import { DIFFICULTY_MAPPING_VERSION, difficultyOf } from "../src/puzzles/difficulty.ts";

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

describe("T-20.3 difficultyOf (mapping version 1)", () => {
  it("is version 1", () => {
    expect(DIFFICULTY_MAPPING_VERSION).toBe("1");
  });

  it.each([
    ["only singles", [30], "easy"],
    ["cage combinations", [30, 8], "easy"],
    ["one level-3 step", [30, 8, 1], "medium"],
    ["two level-3 steps", [30, 8, 2], "hard"],
    ["many level-3 steps", [30, 8, 7], "hard"],
    ["level 4 with one level-3 step", [30, 8, 1, 1], "hard"],
    ["level 4 without level 3", [30, 8, 0, 2], "hard"],
    ["level 5", [30, 8, 1, 0, 1], "expert"],
  ] as const)("%s: %s", (_, steps, expected) => {
    expect(difficultyOf(result(steps))).toBe(expected);
  });

  it("excludes puzzles that exceed the techniques or have no solution", () => {
    expect(difficultyOf(result([10, 5, 3, 1, 1], "exceedsTechniques"))).toBeNull();
    expect(difficultyOf(result([10], "contradiction"))).toBeNull();
  });

  it("the database accepts exactly the protocol's difficulties", () => {
    expect([...DIFFICULTY_VALUES]).toEqual([...DIFFICULTIES]);
  });
});
