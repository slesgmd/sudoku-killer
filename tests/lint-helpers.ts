// Ejecuta la configuración real de ESLint sobre un texto, como si estuviera en `filePath`.
import { ESLint, type Linter } from "eslint";
import tseslint from "typescript-eslint";

const eslint = new ESLint({
  cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  // Sin información de tipos: los archivos de prueba no existen en disco.
  overrideConfig: [tseslint.configs.disableTypeChecked],
});

/** Hasta dónde puede tardar la carga de la configuración y los plugins con la CPU ocupada. */
export const LINT_WARM_UP_MS = 30_000;

/**
 * La primera ejecución carga la configuración y los plugins (unos 2 s sin carga, más si las otras
 * pruebas ocupan la CPU). Cada archivo la hace una vez en su `beforeAll`, así los casos miden solo
 * la regla y no dependen de cuál corre primero.
 */
export async function warmUpLint(): Promise<void> {
  await eslint.lintText("", { filePath: "tests/warm-up.ts" });
}

export async function lintMessages(
  source: string,
  filePath: string,
  ruleId: string,
): Promise<Linter.LintMessage[]> {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? []).filter((message) => message.ruleId === ruleId);
}
