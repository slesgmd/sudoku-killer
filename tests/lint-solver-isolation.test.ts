// T-35.1: los solvers A y B son independientes. B solo importa los tipos de datos y A no importa B.
import { beforeAll, describe, expect, it } from "vitest";
import { lintMessages, LINT_WARM_UP_MS, warmUpLint } from "./lint-helpers.ts";

beforeAll(warmUpLint, LINT_WARM_UP_MS);

const SOLVER_B = "packages/engine/src/solver-b/example.ts";
const SOLVER_A = "packages/engine/src/solver-a/example.ts";

async function violations(source: string, filePath: string): Promise<number> {
  return (await lintMessages(source, filePath, "no-restricted-imports")).length;
}

describe("T-35.1 lint: solver B shares no code with solver A", () => {
  it.each([
    'import { solveA } from "../solver-a/solve.ts";',
    'import { popcount } from "../model/mask.ts";',
    'import { layoutOf } from "../index.ts";',
    'import { layoutOf } from "@sudoku-killer/engine";',
  ])("solver B rejects: %s", async (source) => {
    expect(await violations(`${source}\nexport {};\n`, SOLVER_B)).toBe(1);
  });

  it.each([
    'import type { KillerPuzzle } from "../types.ts";',
    'import { buildMatrix } from "./matrix.ts";',
  ])("solver B allows: %s", async (source) => {
    expect(await violations(`${source}\nexport {};\n`, SOLVER_B)).toBe(0);
  });

  it("solver A cannot import solver B, but can use the model", async () => {
    const source = 'import { solveB } from "../solver-b/solve.ts";\nexport {};\n';
    expect(await violations(source, SOLVER_A)).toBe(1);
    const model = 'import { popcount } from "../model/mask.ts";\nexport {};\n';
    expect(await violations(model, SOLVER_A)).toBe(0);
  });
});
