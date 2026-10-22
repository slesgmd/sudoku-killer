// La aserción `!` solo se permite en los solvers (docs/motor.md, "Aserción de no nulo").
import { describe, expect, it } from "vitest";
import { lintMessages } from "./lint-helpers.ts";

const SOURCE = "const list = [1];\nexport const first = list[0]!;\n";

async function violations(filePath: string): Promise<number> {
  return (await lintMessages(SOURCE, filePath, "@typescript-eslint/no-non-null-assertion")).length;
}

describe("lint: the non-null assertion is limited to the solvers", () => {
  it.each([
    "packages/engine/src/model/example.ts",
    "packages/engine/src/index.ts",
    "packages/engine/test/example.test.ts",
    "packages/engine/test/helpers/example.ts",
    "packages/game/src/example.ts",
  ])("%s rejects it", async (filePath) => {
    expect(await violations(filePath)).toBe(1);
  });

  it.each(["packages/engine/src/solver-a/example.ts", "packages/engine/src/solver-b/example.ts"])(
    "%s allows it",
    async (filePath) => {
      expect(await violations(filePath)).toBe(0);
    },
  );
});
