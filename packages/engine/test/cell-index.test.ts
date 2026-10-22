// Paquete de ejemplo de F3: comprueba Vitest, fast-check y la resolución de fuentes (sin T-xx).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cellIndex, DEFAULT_BOARD_SIZE } from "@sudoku-killer/engine";

describe("cellIndex", () => {
  it("maps the corners of a 9x9 board", () => {
    expect(cellIndex(0, 0)).toBe(0);
    expect(cellIndex(8, 8)).toBe(80);
    expect(DEFAULT_BOARD_SIZE).toBe(9);
  });

  it("rejects cells outside the board", () => {
    expect(() => cellIndex(9, 0)).toThrow(RangeError);
    expect(() => cellIndex(0, -1)).toThrow(RangeError);
  });

  it("is a bijection onto 0..size²-1", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 16 }), fc.nat(), fc.nat(), (size, r, c) => {
        const row = r % size;
        const col = c % size;
        const index = cellIndex(row, col, size);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(size * size);
        expect([Math.floor(index / size), index % size]).toEqual([row, col]);
      }),
    );
  });
});
