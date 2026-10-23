// Regla de lint de las pruebas: las propiedades pasan por `assertProperty`, que imprime la semilla en
// todo fallo y ejecuta las regresiones registradas (docs/motor.md).
import { describe, expect, it } from "vitest";
import { lintMessages } from "./lint-helpers.ts";

const SOURCE = [
  'import fc from "fast-check";',
  "fc.assert(fc.property(fc.nat(), () => true));",
  "export const t = Date.now();",
  "",
].join("\n");

async function restrictedMessages(filePath: string): Promise<string[]> {
  const messages = await lintMessages(SOURCE, filePath, "no-restricted-properties");
  return messages.map((message) => message.message);
}

describe("lint: fc.assert is banned in tests", () => {
  it.each(["apps/server/test/example.test.ts", "tests/example.test.ts"])(
    "%s rejects fc.assert",
    async (filePath) => {
      const messages = await restrictedMessages(filePath);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatch(/assertProperty/);
    },
  );

  it("tests of a pure package also keep the bans on time and randomness", async () => {
    const messages = await restrictedMessages("packages/engine/test/example.test.ts");
    expect(messages).toHaveLength(2);
    expect(messages.join("\n")).toMatch(/assertProperty/);
    expect(messages.join("\n")).toMatch(/Paquete puro/);
  });

  it("source files may use fc.assert", async () => {
    expect(await restrictedMessages("apps/server/src/example.ts")).toEqual([]);
  });
});
