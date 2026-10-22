// Base del validador (T-35.3): geometría, unidades, pares y máscaras de candidatos.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOARD_SIZE,
  cellIndex,
  digitBit,
  digitsOf,
  fullMask,
  hasDigit,
  isValidGeometry,
  layoutOf,
  popcount,
  singleDigit,
} from "@sudoku-killer/engine";
import { at } from "../src/model/at.ts";
import { GEOMETRIES, GEOMETRY_9 } from "./helpers/grids.ts";

describe("T-35.3 geometry", () => {
  it("cellIndex maps the corners of a 9x9 board and rejects cells outside it", () => {
    expect(cellIndex(0, 0)).toBe(0);
    expect(cellIndex(8, 8)).toBe(80);
    expect(DEFAULT_BOARD_SIZE).toBe(9);
    expect(() => cellIndex(9, 0)).toThrow(RangeError);
    expect(() => cellIndex(0, -1)).toThrow(RangeError);
  });

  it("cellIndex is a bijection onto 0..size²-1", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 16 }), fc.nat(), fc.nat(), (size, r, c) => {
        const index = cellIndex(r % size, c % size, size);
        expect([Math.floor(index / size), index % size]).toEqual([r % size, c % size]);
      }),
    );
  });

  it("rejects inconsistent geometries", () => {
    expect(isValidGeometry({ size: 9, boxRows: 2, boxCols: 3 })).toBe(false);
    expect(isValidGeometry({ size: 18, boxRows: 3, boxCols: 6 })).toBe(false);
    expect(isValidGeometry({ size: 6, boxRows: 2, boxCols: 3 })).toBe(true);
    expect(() => layoutOf({ size: 9, boxRows: 2, boxCols: 3 })).toThrow(RangeError);
  });

  it.each(GEOMETRIES)("units partition the $size x $size board", (geometry) => {
    const layout = layoutOf(geometry);
    const { size, boxRows, boxCols } = geometry;
    for (const units of [layout.rows, layout.cols, layout.boxes]) {
      expect(units).toHaveLength(size);
      const all = units.flat().sort((a, b) => a - b);
      expect(all).toEqual(Array.from({ length: size * size }, (_, i) => i));
    }
    const indexes = [
      [layout.rows, layout.rowOf],
      [layout.cols, layout.colOf],
      [layout.boxes, layout.boxOf],
    ] as const;
    for (const [units, unitOf] of indexes) {
      units.forEach((cells, unit) => {
        for (const cell of cells) expect(unitOf[cell]).toBe(unit);
      });
    }
    layout.peers.forEach((peers, cell) => {
      // Fila y columna (2·(size−1)) más el resto de la caja que no está en ellas.
      expect(peers).toHaveLength(2 * (size - 1) + (boxRows - 1) * (boxCols - 1));
      for (const peer of peers) expect(layout.peers[peer]).toContain(cell);
    });
  });

  it("at returns the element or throws outside the list", () => {
    expect(at([4, 0], 1)).toBe(0);
    expect(at(Uint8Array.of(7), 0)).toBe(7);
    expect(() => at([1, 2], 2)).toThrow(RangeError);
    expect(() => at([1, 2], -1)).toThrow(RangeError);
  });

  it("a 9x9 cell has 20 peers and boxes are 3x3", () => {
    const layout = layoutOf(GEOMETRY_9);
    expect(layout.peers[0]).toHaveLength(20);
    expect(layout.boxes[4]).toEqual([30, 31, 32, 39, 40, 41, 48, 49, 50]);
  });
});

describe("T-35.3 candidate masks", () => {
  it("digitsOf, digitBit, popcount and singleDigit agree", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: fullMask(16) }), (mask) => {
        const digits = digitsOf(mask);
        expect(digits.reduce((m, d) => m | digitBit(d), 0)).toBe(mask);
        expect(popcount(mask)).toBe(digits.length);
        expect(singleDigit(mask)).toBe(digits.length === 1 ? digits[0] : 0);
        for (let d = 1; d <= 16; d++) expect(hasDigit(mask, d)).toBe(digits.includes(d));
      }),
    );
  });

  it("fullMask has the digits 1..size", () => {
    expect(digitsOf(fullMask(9))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
