// Ejecuta la configuración real de ESLint sobre un texto, como si estuviera en `filePath`.
import { ESLint, type Linter } from "eslint";
import tseslint from "typescript-eslint";

const eslint = new ESLint({
  cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  // Sin información de tipos: los archivos de prueba no existen en disco.
  overrideConfig: [tseslint.configs.disableTypeChecked],
});

export async function lintMessages(
  source: string,
  filePath: string,
  ruleId: string,
): Promise<Linter.LintMessage[]> {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? []).filter((message) => message.ruleId === ruleId);
}
