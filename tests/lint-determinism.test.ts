// Regla de lint de los paquetes puros (ADR 0004): sostiene la reproducción determinista de T-32.1.
import { describe, expect, it } from "vitest";
import { lintMessages } from "./lint-helpers.ts";

const SOURCE = "export const t = Date.now();\nexport const r = Math.random();\n";

async function restrictedMessages(filePath: string): Promise<string[]> {
  const messages = await lintMessages(SOURCE, filePath, "no-restricted-properties");
  return messages.map((message) => message.message);
}

describe("lint: Date.now() and Math.random() are banned in pure packages", () => {
  it.each(["engine", "scoring", "game"])("packages/%s rejects both calls", async (pkg) => {
    const messages = await restrictedMessages(`packages/${pkg}/src/example.ts`);
    expect(messages).toHaveLength(2);
    expect(messages.join("\n")).toMatch(/Date\.now/);
    expect(messages.join("\n")).toMatch(/Math\.random/);
  });

  it.each(["apps/server/src/example.ts", "packages/protocol/src/example.ts"])(
    "%s may use them",
    async (filePath) => {
      expect(await restrictedMessages(filePath)).toEqual([]);
    },
  );
});
