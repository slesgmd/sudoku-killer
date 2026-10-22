// Regla de lint de los paquetes puros (ADR 0004): sostiene la reproducción determinista de T-32.1.
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({
  cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  // Sin información de tipos: los archivos de prueba no existen en disco.
  overrideConfig: [tseslint.configs.disableTypeChecked],
});

const SOURCE = "export const t = Date.now();\nexport const r = Math.random();\n";

async function restrictedMessages(filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(SOURCE, { filePath });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === "no-restricted-properties")
    .map((message) => message.message);
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
