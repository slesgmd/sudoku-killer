// T-35.6 (parte del PRNG): el azar del generador sale de una semilla y es reproducible.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createRng, isValidSeed } from "@sudoku-killer/engine";
import { shuffle, weightedIndex } from "../src/generator/rng.ts";
import { assertProperty } from "./helpers/property.ts";

const seedArb = fc.nat({ max: 0xffff_ffff });

function take(seed: number, count: number): number[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng.next());
}

describe("T-35.6 seeded PRNG", () => {
  it("the same seed gives the same sequence of 32-bit integers", () => {
    assertProperty(
      fc.property(seedArb, (seed) => {
        const sequence = take(seed, 50);
        expect(take(seed, 50)).toEqual(sequence);
        for (const value of sequence) {
          expect(Number.isInteger(value) && value >= 0 && value < 2 ** 32).toBe(true);
        }
      }),
    );
  });

  it("neighbouring seeds give unrelated sequences", () => {
    const firsts = new Set(Array.from({ length: 1000 }, (_, seed) => take(seed, 1)[0]));
    expect(firsts.size).toBe(1000);
  });

  it("int(bound) stays in range and is roughly uniform", () => {
    const rng = createRng(7);
    const counts = new Array<number>(9).fill(0);
    for (let i = 0; i < 90_000; i++) {
      const value = rng.int(9);
      counts[value] = (counts[value] ?? 0) + 1;
    }
    // Chi-cuadrado con 8 grados de libertad: el valor crítico al 0,1 % es 26,1.
    const chi = counts.reduce((total, count) => total + (count - 10_000) ** 2 / 10_000, 0);
    expect(chi).toBeLessThan(26.1);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(90_000);
  });

  it("shuffle returns a permutation, and weightedIndex never picks a zero weight", () => {
    assertProperty(
      fc.property(seedArb, fc.array(fc.nat(), { maxLength: 30 }), (seed, list) => {
        const rng = createRng(seed);
        const shuffled = shuffle(rng, [...list]);
        expect([...shuffled].sort((a, b) => a - b)).toEqual([...list].sort((a, b) => a - b));
        const index = weightedIndex(rng, [0, 3, 0, 1]);
        expect([1, 3]).toContain(index);
      }),
    );
  });

  it("rejects invalid seeds, bounds and weights", () => {
    for (const seed of [-1, 0.5, 2 ** 32, NaN, Infinity]) {
      expect(isValidSeed(seed)).toBe(false);
      expect(() => createRng(seed)).toThrow(RangeError);
    }
    expect(isValidSeed(0)).toBe(true);
    expect(isValidSeed(2 ** 32 - 1)).toBe(true);
    const rng = createRng(1);
    for (const bound of [0, -1, 1.5, 2 ** 32 + 1]) expect(() => rng.int(bound)).toThrow(RangeError);
    for (const weights of [[], [0, 0], [1, -1], [0.5, 1]]) {
      expect(() => weightedIndex(rng, weights)).toThrow(RangeError);
    }
  });
});
