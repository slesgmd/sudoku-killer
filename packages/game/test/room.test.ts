// Reglas puras de la sala (SPEC D2, §2.3 y §3.3).
import fc from "fast-check";
import { createRng } from "@sudoku-killer/engine";
import { ROOM_CODE_ALPHABET, isRoomCodeShape, type Connection } from "@sudoku-killer/protocol";
import { describe, expect, it } from "vitest";
import { assertProperty } from "../../engine/test/helpers/property.ts";
import { freeSeat, generateRoomCode, nextStarter, seatFor } from "../src/index.ts";

const member = (id: string, seat: number | null, joinedAt: number, connection: Connection) => ({
  id,
  seat,
  joinedAt,
  connection,
});

describe("room code (D2)", () => {
  it("T-09.4 codes have 6 characters of the alphabet and never collide with an existing room", () => {
    assertProperty(
      fc.property(fc.nat(), fc.integer({ min: 0, max: 200 }), (seed, rooms) => {
        const rng = createRng(seed);
        const existing = new Set<string>();
        for (let i = 0; i <= rooms; i++) {
          const code = generateRoomCode(rng, (c) => existing.has(c));
          expect(code).toHaveLength(6);
          expect(code).toMatch(new RegExp(`^[${ROOM_CODE_ALPHABET}]+$`));
          expect(isRoomCodeShape(code)).toBe(true);
          expect(existing.has(code)).toBe(false);
          existing.add(code);
        }
      }),
    );
  });

  it("T-09.4 retries when the drawn code is taken", () => {
    const first = generateRoomCode(createRng(3), () => false);
    const second = generateRoomCode(createRng(3), (code) => code === first);
    expect(second).not.toBe(first);
  });
});

describe("seats (R-08)", () => {
  it("connected and disconnected players hold their seat; left and expired do not", () => {
    const members = [
      member("a", 0, 1, "connected"),
      member("b", 1, 2, "disconnected"),
      member("c", 2, 3, "left"),
      member("d", 3, 4, "expired"),
    ];
    expect(freeSeat(members, 6)).toBe(2);
    expect(freeSeat(members.slice(0, 2), 2)).toBeNull();
  });

  it("a returning player gets the same seat if it is free, or the first free one", () => {
    const members = [member("a", 0, 1, "connected"), member("b", 2, 2, "connected")];
    expect(seatFor(members, 6, 1)).toBe(1);
    expect(seatFor(members, 6, 2)).toBe(1);
    expect(seatFor(members, 6, null)).toBe(1);
  });
});

describe("starter (R-11)", () => {
  it("passes to the player with a seat and the lowest joinedAt", () => {
    const members = [
      member("z", null, 0, "left"),
      member("b", 1, 20, "connected"),
      member("a", 2, 10, "disconnected"),
      member("c", 3, 5, "expired"),
    ];
    expect(nextStarter(members)).toBe("a");
    expect(nextStarter([member("y", 0, 7, "connected"), member("x", 1, 7, "connected")])).toBe("x");
    expect(nextStarter([member("z", null, 0, "left")])).toBeNull();
  });
});
