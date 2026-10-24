// Informe de módulos del build (T-31.2): qué módulos fuente terminaron en cada chunk, con código. Se
// escribe junto a la carpeta de salida, nunca dentro, para que no se publique.
import { writeFileSync } from "node:fs";
import path from "node:path";

/** Lo mínimo del bundle de Rollup que se lee. */
type BundleLike = Readonly<
  Record<
    string,
    | {
        readonly type: "chunk";
        readonly modules: Readonly<Record<string, { readonly renderedLength: number }>>;
      }
    | { readonly type: "asset" }
  >
>;

/** Módulos con código de cada chunk: `{ "assets/index-abc.js": ["/abs/src/main.tsx", …] }`. */
export type ModuleReport = Record<string, string[]>;

export function moduleReportPath(outDir: string): string {
  const resolved = path.resolve(outDir);
  return path.join(path.dirname(resolved), `.${path.basename(resolved)}-modules.json`);
}

export function writeModuleReport(outDir: string, bundle: BundleLike): void {
  const report: ModuleReport = {};
  for (const [fileName, output] of Object.entries(bundle)) {
    if (output.type !== "chunk") continue;
    report[fileName] = Object.entries(output.modules)
      .filter(([, info]) => info.renderedLength > 0)
      .map(([id]) => id.replaceAll("\\", "/"));
  }
  writeFileSync(moduleReportPath(outDir), `${JSON.stringify(report, null, 2)}\n`);
}
