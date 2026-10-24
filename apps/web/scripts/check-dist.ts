// T-31.2: el build de producción del cliente no incluye el servidor simulado ni ninguna solución.
// Revisa dos cosas del build:
// - los módulos fuente de cada chunk (informe de `module-report.ts`): nada del simulador, del banco,
//   del manifiesto, ni del motor o de `packages/game` fuera de lo permitido al cliente;
// - el texto de cada archivo emitido: el identificador `solution`, las claves del manifiesto, la
//   marca del simulador y cualquier solución serializada (81 dígitos o un arreglo de 81 dígitos).
// Si da un falso positivo, se corrigen los imports del cliente, nunca este detector.
// Uso: `node scripts/check-dist.ts [carpeta]` (por defecto `dist`).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { moduleReportPath, type ModuleReport } from "./module-report.ts";

export interface Finding {
  readonly file: string;
  readonly rule: string;
  readonly detail: string;
}

/** Paquetes que el cliente puede incluir enteros: el protocolo no lleva la solución (T-31.3). */
const ALLOWED_PACKAGES = ["packages/protocol/src/"];

/** Módulos de los demás paquetes del monorepo que el cliente de producción puede incluir. */
const ALLOWED_PACKAGE_MODULES = [
  // Motor: geometría, máscaras y limpieza de notas.
  "packages/engine/src/model.ts",
  "packages/engine/src/types.ts",
  "packages/engine/src/model/at.ts",
  "packages/engine/src/model/geometry.ts",
  "packages/engine/src/model/mask.ts",
  "packages/engine/src/model/notes.ts",
  // Partida: solo el punto de entrada del cliente.
  "packages/game/src/client.ts",
  "packages/game/src/permissions.ts",
  "packages/game/src/board.ts",
  // Puntuación: solo los parámetros (H en la confirmación de pista).
  "packages/scoring/src/index.ts",
  "packages/scoring/src/params.ts",
  "packages/scoring/src/params.v1.json",
];

const FORBIDDEN_MODULES: readonly { readonly rule: string; readonly pattern: RegExp }[] = [
  { rule: "simulator module", pattern: /\/apps\/web\/src\/dev\// },
  { rule: "bank module", pattern: /\/packages\/bank\// },
  { rule: "bank manifest", pattern: /manifest\.json$/ },
];

const FORBIDDEN_TEXT: readonly { readonly rule: string; readonly pattern: RegExp }[] = [
  { rule: "solution field", pattern: /\bsolution\b/ },
  {
    rule: "manifest key",
    pattern: /\b(graderSteps|graderMaxLevel|mappingVersion|unitCombinationBound)\b/,
  },
  { rule: "simulator marker", pattern: /\[sim\]/ },
  { rule: "serialized solution", pattern: /[1-9]{81}/ },
  { rule: "solution array", pattern: /\[\s*(?:[1-9]\s*,\s*){80}[1-9]\s*,?\s*\]/ },
];

function packageModule(id: string): string | null {
  const match = /\/(packages\/[^/]+\/.*)$/.exec(id);
  return match?.[1] ?? null;
}

/** Revisa el informe de módulos. */
export function findModuleLeaks(report: ModuleReport): Finding[] {
  const findings: Finding[] = [];
  for (const [file, ids] of Object.entries(report)) {
    for (const id of ids) {
      for (const { rule, pattern } of FORBIDDEN_MODULES) {
        if (pattern.test(id)) findings.push({ file, rule, detail: id });
      }
      const local = packageModule(id);
      const allowed =
        local === null ||
        local.includes("/node_modules/") ||
        ALLOWED_PACKAGES.some((prefix) => local.startsWith(prefix)) ||
        ALLOWED_PACKAGE_MODULES.includes(local);
      if (local && !allowed) {
        findings.push({ file, rule: "package module not allowed in the client", detail: local });
      }
    }
  }
  return findings;
}

function filesOf(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesOf(full) : [full];
  });
}

/** Revisa el texto de los archivos emitidos (los binarios, como las fuentes, se saltan). */
export function findTextLeaks(dir: string): Finding[] {
  const findings: Finding[] = [];
  for (const full of filesOf(dir)) {
    if (!/\.(js|mjs|css|html|json|map|txt|svg)$/.test(full)) continue;
    const text = readFileSync(full, "utf8");
    const file = path.relative(dir, full).replaceAll("\\", "/");
    for (const { rule, pattern } of FORBIDDEN_TEXT) {
      const match = pattern.exec(text);
      if (match) findings.push({ file, rule, detail: match[0].slice(0, 40) });
    }
  }
  return findings;
}

/** Revisa un build completo: su carpeta y su informe de módulos. */
export function checkDist(dir: string): Finding[] {
  const reportFile = moduleReportPath(dir);
  if (!existsSync(reportFile)) {
    return [
      { file: reportFile, rule: "missing module report", detail: "build with vite.config.ts" },
    ];
  }
  const report = JSON.parse(readFileSync(reportFile, "utf8")) as ModuleReport;
  return [...findModuleLeaks(report), ...findTextLeaks(dir)];
}

if (import.meta.main) {
  const dir = path.resolve(process.argv[2] ?? "dist");
  const findings = checkDist(dir);
  if (findings.length > 0) {
    console.error(`T-31.2: the production build leaks ${String(findings.length)} item(s):`);
    for (const { file, rule, detail } of findings) console.error(`- ${file}: ${rule} (${detail})`);
    process.exit(1);
  }
  console.log("T-31.2: the production build has no simulator and no solution.");
}
