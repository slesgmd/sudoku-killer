// Los logs de Actions son públicos (F12, docs/seguridad.md §3): ningún workflow nuevo imprime cadenas
// de conexión, claves, hashes, apodos ni contenido de la base, solo recuentos. Todo workflow que no
// sea de los anteriores a F12 cumple estas reglas, y `scripts/ci/quiet.ts` solo deja pasar las
// líneas de recuento o de estado.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { PUBLIC_LINE, filterOutput } from "../scripts/ci/quiet.ts";

const DIR = new URL("../.github/workflows/", import.meta.url);

/** Los workflows anteriores a F12: solo usan bases efímeras del job, sin datos reales. */
const BEFORE_F12 = new Set(["ci.yml", "chaos.yml", "corpus.yml", "load.yml"]);

/** Las acciones permitidas en un workflow con secretos o con la base. */
const ALLOWED_ACTIONS = [
  "actions/checkout@",
  "pnpm/action-setup@",
  "actions/setup-node@",
  "actions/upload-artifact@",
  "actions/download-artifact@",
];

const QUIET = "node scripts/ci/quiet.ts -- ";

interface Step {
  readonly name?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly with?: Record<string, unknown>;
  readonly env?: Record<string, unknown>;
}

interface Job {
  readonly env?: Record<string, unknown>;
  readonly services?: unknown;
  readonly steps?: readonly Step[];
}

interface Workflow {
  readonly on?: Record<string, unknown>;
  readonly env?: Record<string, unknown>;
  readonly permissions?: Record<string, unknown>;
  readonly jobs?: Record<string, Job>;
}

function workflows(): [string, Workflow, string][] {
  return readdirSync(DIR)
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
    .map((file) => {
      const text = readFileSync(new URL(file, DIR), "utf8");
      return [file, parse(text) as Workflow, text];
    });
}

/** Lo que viola las reglas de los logs públicos en un workflow. */
export function violations(workflow: Workflow, text: string): string[] {
  const found: string[] = [];
  if (/ACTIONS_(?:STEP|RUNNER)_DEBUG/.test(text)) found.push("debug logging");
  const triggers = Object.keys(workflow.on ?? {});
  if (triggers.some((trigger) => trigger !== "workflow_dispatch" && trigger !== "schedule"))
    found.push(`trigger other than workflow_dispatch or schedule: ${triggers.join(", ")}`);
  if (workflow.permissions?.["contents"] !== "read") found.push("permissions.contents is not read");
  if (JSON.stringify(workflow.env ?? {}).includes("secrets.")) found.push("secret in workflow env");
  for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
    if (JSON.stringify(job.env ?? {}).includes("secrets."))
      found.push(`${name}: secret in job env`);
    if (job.services !== undefined) found.push(`${name}: service containers print their logs`);
    for (const step of job.steps ?? []) {
      const label = `${name}/${step.name ?? step.uses ?? step.run ?? "?"}`;
      if (step.uses !== undefined) {
        if (!ALLOWED_ACTIONS.some((prefix) => step.uses?.startsWith(prefix)))
          found.push(`${label}: action not allowed`);
        if (JSON.stringify(step.with ?? {}).includes("secrets."))
          found.push(`${label}: secret passed to an action`);
        const path = step.with?.["path"];
        if (step.uses.startsWith("actions/upload-artifact@") && !String(path).endsWith(".age"))
          found.push(`${label}: uploads something that is not encrypted with age`);
      }
      if (step.run === undefined) continue;
      if (step.run.includes("${{")) found.push(`${label}: expression inside run (use env)`);
      for (const line of step.run.split("\n")) {
        const command = line.trim();
        if (command === "" || command.startsWith("#")) continue;
        if (!command.startsWith(QUIET)) found.push(`${label}: command without quiet.ts`);
        if (/\bset\s+-[a-z]*x/.test(command)) found.push(`${label}: set -x`);
      }
    }
  }
  return found;
}

describe("F12 public Actions logs (docs/seguridad.md §3)", () => {
  it("every workflow added since F12 follows the rules", () => {
    const checked = workflows().filter(([file]) => !BEFORE_F12.has(file));
    expect(checked.map(([file]) => file)).toEqual(
      expect.arrayContaining(["smoke.yml", "backup.yml", "restore-drill.yml", "db-admin.yml"]),
    );
    for (const [file, workflow, text] of checked) {
      expect(violations(workflow, text), file).toEqual([]);
    }
  });

  it("the rules catch an unsafe workflow (negative check)", () => {
    const unsafe = `
on:
  push:
permissions:
  contents: write
env:
  DATABASE_URL: \${{ secrets.DATABASE_URL }}
jobs:
  dump:
    services:
      postgres:
        image: postgres:18
    steps:
      - uses: some/action@v1
      - run: |
          set -x
          pg_dump "$DATABASE_URL"
      - run: node scripts/ci/quiet.ts -- echo \${{ secrets.KEY }}
      - uses: actions/upload-artifact@v7
        with:
          path: dump.sql
`;
    const found = violations(parse(unsafe) as Workflow, unsafe);
    for (const expected of [
      "trigger other than",
      "permissions.contents",
      "secret in workflow env",
      "service containers",
      "action not allowed",
      "command without quiet.ts",
      "set -x",
      "expression inside run",
      "not encrypted with age",
    ])
      expect(
        found.some((message) => message.includes(expected)),
        expected,
      ).toBe(true);
  });

  it("quiet.ts only lets through namespaced counts and states", () => {
    const output = [
      "backup.puzzles: 2000",
      "smoke.healthz: ok",
      "restore.match_events: 15321",
      "db.migrations_pending: 0",
      "postgres://user:secret@ep-x.us-east-1.aws.neon.tech/db",
      "ana: 3",
      "Ana",
      "backup.nickname: Ana",
      "ERROR: duplicate key value violates unique constraint DETAIL: Key (nickname)=(Ana)",
      "access hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    ].join("\n");
    const { shown, hidden } = filterOutput(output);
    expect(shown).toEqual([
      "backup.puzzles: 2000",
      "smoke.healthz: ok",
      "restore.match_events: 15321",
      "db.migrations_pending: 0",
    ]);
    expect(hidden).toBe(6);
    expect(PUBLIC_LINE.test("smoke.web_status: fail")).toBe(true);
    expect(PUBLIC_LINE.test("backup.puzzles: 2000 postgres://x")).toBe(false);
  });
});
