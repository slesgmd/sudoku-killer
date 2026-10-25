// La clave de acceso en el handshake (F12, R-39): normalización, ida y vuelta por el subprotocolo
// (con caracteres fuera de ASCII) y rechazo de lo que no es una clave.
import { describe, expect, it } from "vitest";
import {
  ACCESS_PROTOCOL,
  KEY_PROTOCOL_PREFIX,
  accessProtocols,
  keyFromProtocols,
  normalizeAccessKey,
} from "../src/index.ts";

describe("F12 access key protocol (R-39)", () => {
  it("normalizes case, spaces and dashes, so a typed key matches the generated one", () => {
    expect(normalizeAccessKey(" abcd-efgh jkmn-pqrs ")).toBe("ABCDEFGHJKMNPQRS");
    expect(normalizeAccessKey("ＡＢＣＤ")).toBe("ABCD");
  });

  it("T-39.1 offers sk.v1 alone without a key, and the key as base64url with one", () => {
    expect(accessProtocols(null)).toEqual([ACCESS_PROTOCOL]);
    expect(accessProtocols("  ")).toEqual([ACCESS_PROTOCOL]);
    const offered = accessProtocols("abcd-efgh-jkmn-pqrs");
    expect(offered[0]).toBe(ACCESS_PROTOCOL);
    expect(offered[1]?.startsWith(KEY_PROTOCOL_PREFIX)).toBe(true);
    // Un token de HTTP válido: solo letras, dígitos, punto, guion y guion bajo.
    expect(offered[1]).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(offered.join()).not.toContain("ABCD");
    expect(keyFromProtocols(offered)).toBe("ABCDEFGHJKMNPQRS");
    expect(keyFromProtocols(accessProtocols("Ñandú en Miraflores 2026"))).toBe(
      "ÑANDÚENMIRAFLORES2026",
    );
  });

  it("finds no key in a missing, malformed, too short or too long offer", () => {
    expect(keyFromProtocols([ACCESS_PROTOCOL])).toBeNull();
    expect(keyFromProtocols([`${KEY_PROTOCOL_PREFIX}@@@`])).toBeNull();
    expect(keyFromProtocols(accessProtocols("corta"))).toBeNull();
    expect(keyFromProtocols(accessProtocols("x".repeat(65)))).toBeNull();
    // Bytes que no son UTF-8.
    expect(keyFromProtocols([`${KEY_PROTOCOL_PREFIX}_w`])).toBeNull();
  });
});
