// T-17.1 (parte unitaria): cleanupPeers quita el dígito de los pares (fila, columna, caja y jaula)
// y vacía la celda bloqueada, sin tocar nada más (R-17, ADR 0005).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  cageIndexByCell,
  cleanupPeers,
  clearCellNotes,
  digitBit,
  digitsOf,
  fullMask,
  layoutOf,
  peersWithCage,
  type KillerPuzzle,
} from "@sudoku-killer/engine";
import { at } from "../src/model/at.ts";
import { GEOMETRY_9, anyKillerArb } from "./helpers/grids.ts";
import { assertProperty } from "./helpers/property.ts";

const notesArb = (puzzle: KillerPuzzle): fc.Arbitrary<Uint16Array> =>
  fc
    .array(fc.integer({ min: 0, max: fullMask(puzzle.size) }), {
      minLength: puzzle.size ** 2,
      maxLength: puzzle.size ** 2,
    })
    .map((masks) => Uint16Array.from(masks));

describe("T-17.1 cleanupPeers", () => {
  it("removes the digit from every peer, empties the cell and reports exactly what changed", () => {
    const scenario = anyKillerArb.chain(({ puzzle }) =>
      fc.record({
        puzzle: fc.constant(puzzle),
        notes: notesArb(puzzle),
        cell: fc.nat({ max: puzzle.size ** 2 - 1 }),
        digit: fc.integer({ min: 1, max: puzzle.size }),
      }),
    );
    assertProperty(
      fc.property(scenario, ({ puzzle, notes, cell, digit }) => {
        const before = notes.slice();
        const { notes: after, removed } = cleanupPeers(puzzle, notes, cell, digit);
        const layout = layoutOf(puzzle);
        const cage = puzzle.cages[at(cageIndexByCell(layout.cellCount, puzzle.cages), cell)];
        const peers = new Set(peersWithCage(layout, cage, cell));

        expect(notes).toEqual(before);
        expect(after[cell]).toBe(0);
        const expected: { cell: number; digit: number }[] = [];
        before.forEach((mask, other) => {
          if (other === cell) {
            for (const d of digitsOf(mask)) expected.push({ cell: other, digit: d });
          } else if (peers.has(other)) {
            expect(after[other]).toBe(mask & ~digitBit(digit));
            if (mask & digitBit(digit)) expected.push({ cell: other, digit });
          } else {
            expect(after[other]).toBe(mask);
          }
        });
        expected.sort((a, b) => a.cell - b.cell || a.digit - b.digit);
        expect(removed).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("reaches a cage peer that shares no row, column or box", () => {
    const puzzle: KillerPuzzle = {
      ...GEOMETRY_9,
      cages: [{ id: 0, cells: [2, 3, 12], sum: 12 }],
      givens: [],
    };
    const notes = new Uint16Array(81).fill(fullMask(9));
    const { notes: after } = cleanupPeers(puzzle, notes, 2, 5);
    expect(after[12]).toBe(fullMask(9) & ~digitBit(5)); // solo por la jaula
    expect(after[40]).toBe(fullMask(9)); // no es par
    expect(after[2]).toBe(0);
  });

  it("clearCellNotes only empties the cell (personal notes with auto-clean off)", () => {
    const notes = Uint16Array.from([0b101, 0b11]);
    const { notes: after, removed } = clearCellNotes(notes, 0);
    expect([...after]).toEqual([0, 0b11]);
    expect(removed).toEqual([
      { cell: 0, digit: 1 },
      { cell: 0, digit: 3 },
    ]);
  });
});
