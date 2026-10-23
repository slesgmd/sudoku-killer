// Ayuda de propiedades: todo fallo de una prueba aleatoria imprime su semilla, y las semillas
// registradas como regresión se ejecutan siempre (docs/motor.md).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assertProperty, seedMessage } from "./helpers/property.ts";

describe("assertProperty", () => {
  it("prints the seed and the path when the property fails", () => {
    expect(() => assertProperty(fc.property(fc.nat(), (n) => n < 100))).toThrow(
      /seed: -?\d+, path: "[\d:]+"/,
    );
  });

  it("returns the seed of a passing run for later checks", () => {
    const seed = assertProperty(
      fc.property(fc.nat(), () => true),
      { numRuns: 3 },
    );
    expect(Number.isInteger(seed)).toBe(true);
    expect(seedMessage(seed)).toContain(String(seed));
  });

  it("runs every regression seed before a fresh one, with the same values", () => {
    const seen: number[] = [];
    const property = fc.property(fc.nat(), (n) => {
      seen.push(n);
    });
    assertProperty(property, { numRuns: 4, regressions: [{ seed: 42 }] });
    const replay: number[] = [];
    assertProperty(
      fc.property(fc.nat(), (n) => {
        replay.push(n);
      }),
      { numRuns: 4, regressions: [{ seed: 42 }] },
    );
    expect(seen).toHaveLength(8);
    expect(replay.slice(0, 4)).toEqual(seen.slice(0, 4));
  });

  it("a failing regression fails the test with its own seed", () => {
    const failing = fc.check(
      fc.property(fc.nat(), (n) => n % 7 !== 3),
      { numRuns: 1000 },
    );
    expect(failing.failed).toBe(true);
    const { seed, counterexamplePath } = failing;
    expect(() =>
      assertProperty(
        fc.property(fc.nat(), (n) => n % 7 !== 3),
        { regressions: [{ seed, path: counterexamplePath ?? "" }] },
      ),
    ).toThrow(new RegExp(`seed: ${String(seed)}`));
  });
});
