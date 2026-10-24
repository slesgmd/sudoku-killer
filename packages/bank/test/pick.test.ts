// Elección del puzzle sin repetir (R-21, D9).
import fc from "fast-check";
import { createRng } from "@sudoku-killer/engine";
import { describe, expect, it } from "vitest";
import { assertProperty } from "../../engine/test/helpers/property.ts";
import { pickPuzzle } from "../src/index.ts";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${String(i)}`);

describe("pickPuzzle (R-21)", () => {
  it("T-21.1 (U) never repeats while there are unplayed puzzles", () => {
    assertProperty(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.nat(), (n, seed) => {
        const available = ids(n);
        const rng = createRng(seed);
        const played: string[] = [];
        for (let i = 0; i < n; i++) {
          const id = pickPuzzle(available, played, rng);
          expect(id).not.toBeNull();
          expect(played).not.toContain(id);
          played.push(id ?? "");
        }
        expect(new Set(played).size).toBe(n);
      }),
    );
  });

  it("T-21.2 once all were played, picks the one played longest ago", () => {
    const rng = createRng(1);
    expect(pickPuzzle(["a", "b", "c"], ["b", "a", "c"], rng)).toBe("b");
    // `b` se volvió a jugar después: ahora el más antiguo es `a`.
    expect(pickPuzzle(["a", "b", "c"], ["b", "a", "c", "b"], rng)).toBe("a");
    // Las partidas de otra dificultad no cuentan.
    expect(pickPuzzle(["a", "b"], ["x", "b", "y", "a"], rng)).toBe("b");
  });

  it("returns null without available puzzles, and is deterministic with the seed", () => {
    expect(pickPuzzle([], ["a"], createRng(1))).toBeNull();
    const pick = (seed: number) => pickPuzzle(ids(50), ["p3"], createRng(seed));
    expect(pick(7)).toBe(pick(7));
  });
});
