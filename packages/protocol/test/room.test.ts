// Apodo y código de sala (SPEC D2).
import { describe, expect, it } from "vitest";
import {
  ROOM_CODE_ALPHABET,
  isRoomCodeShape,
  isValidNickname,
  nicknameKey,
  normalizeNickname,
} from "../src/index.ts";

describe("nickname (D2)", () => {
  it("T-09.3 a nickname of 1 or 17 characters, or empty after trimming, is invalid", () => {
    expect(isValidNickname("A")).toBe(false);
    expect(isValidNickname("A".repeat(17))).toBe(false);
    expect(isValidNickname("    ")).toBe(false);
    expect(isValidNickname(" A ")).toBe(false);
    expect(isValidNickname("Al")).toBe(true);
    expect(isValidNickname("A".repeat(16))).toBe(true);
    expect(isValidNickname(`  ${"A".repeat(16)}  `)).toBe(true);
  });

  it("T-09.3 counts characters as people see them, not UTF-16 units", () => {
    expect(isValidNickname("🙂🙂")).toBe(true);
    expect(isValidNickname("👩‍👩‍👧")).toBe(false); // un solo grafema
    expect(isValidNickname("🙂".repeat(16))).toBe(true);
    expect(isValidNickname("🙂".repeat(17))).toBe(false);
  });

  it("T-09.2 the uniqueness key ignores case and Unicode compatibility forms", () => {
    expect(nicknameKey("Ana")).toBe(nicknameKey("ana"));
    expect(nicknameKey(" ANA ")).toBe("ana");
    expect(nicknameKey("Ａｎａ")).toBe("ana"); // ancho completo, NFKC
    expect(normalizeNickname("  Inés ")).toBe("Inés");
  });
});

describe("room code (D2)", () => {
  it("the alphabet has no 0, O, 1, I or L", () => {
    for (const char of "0O1IL") expect(ROOM_CODE_ALPHABET).not.toContain(char);
    expect(ROOM_CODE_ALPHABET).toHaveLength(31);
  });

  it("accepts 6 characters of the alphabet, in any case", () => {
    expect(isRoomCodeShape("HPQ6NZ")).toBe(true);
    expect(isRoomCodeShape("hpq6nz")).toBe(true);
    expect(isRoomCodeShape("HPQ6N")).toBe(false);
    expect(isRoomCodeShape("HPQ6NO")).toBe(false);
  });
});
