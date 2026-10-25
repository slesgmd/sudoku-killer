// Las acciones de los workflows corren con Node 24 (F12): GitHub avisa en cada ejecución por las que
// todavía usan Node 20 (`actions/upload-artifact@v5` en `backup.yml` y `load.yml`). La tabla dice
// desde qué versión mayor cada acción declara `runs.using: node24` en su `action.yml`; una acción
// nueva tiene que entrar en la tabla.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const DIR = new URL("../.github/workflows/", import.meta.url);

/** La primera versión mayor con Node 24 (comprobada en el `action.yml` de cada etiqueta, 2026-10-25). */
const NODE24_SINCE: Readonly<Record<string, number>> = {
  "actions/checkout": 5,
  "actions/setup-node": 5,
  "actions/upload-artifact": 6,
  "actions/download-artifact": 7,
  "pnpm/action-setup": 5,
};

interface Workflow {
  readonly jobs?: Record<string, { readonly steps?: readonly { readonly uses?: string }[] }>;
}

/** Las acciones de un workflow que no corren con Node 24 (o que no están en la tabla). */
export function oldActions(workflow: Workflow): string[] {
  const found: string[] = [];
  for (const job of Object.values(workflow.jobs ?? {}))
    for (const { uses } of job.steps ?? []) {
      if (uses === undefined) continue;
      const match = /^([^@]+)@v(\d+)(?:\.\d+)*$/.exec(uses);
      const since = match?.[1] === undefined ? undefined : NODE24_SINCE[match[1]];
      if (since === undefined || Number(match?.[2]) < since) found.push(uses);
    }
  return found;
}

describe("F12 actions on Node 24", () => {
  it("every workflow uses actions that run on Node 24", () => {
    const files = readdirSync(DIR).filter((file) => /\.ya?ml$/.test(file));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const workflow = parse(readFileSync(new URL(file, DIR), "utf8")) as Workflow;
      expect(oldActions(workflow), file).toEqual([]);
    }
  });

  it("catches an action still on Node 20, one pinned by commit and one not in the table (negative check)", () => {
    const workflow = parse(`
jobs:
  backup:
    steps:
      - uses: actions/checkout@v7
      - uses: actions/upload-artifact@v5
      - uses: actions/setup-node@v4.4.0
      - uses: actions/cache@v5
      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567
`) as Workflow;
    expect(oldActions(workflow)).toEqual([
      "actions/upload-artifact@v5",
      "actions/setup-node@v4.4.0",
      "actions/cache@v5",
      "actions/checkout@0123456789abcdef0123456789abcdef01234567",
    ]);
  });
});
