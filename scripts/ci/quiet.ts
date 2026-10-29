// Envoltorio de los pasos de Actions que tocan secretos o la base (docs/seguridad.md §3): los
// logs de un repositorio público son públicos. Corre el comando con su salida retenida en memoria y
// solo deja pasar las líneas de recuento o de estado con una clave de los scripts del proyecto
// (`backup.puzzles: 2000`, `smoke.healthz: ok`, …); el resto se cuenta y se descarta. Si el comando falla, dice el código de salida, nunca su salida.
//   node scripts/ci/quiet.ts -- comando [argumentos…]
import { spawn } from "node:child_process";

/**
 * Una línea publicable: una clave con el prefijo de un script del proyecto (así un apodo suelto nunca
 * pasa) y un número o un estado.
 */
export const PUBLIC_LINE =
  /^(?:backup|restore|smoke|db|quiet)\.[a-z0-9_.-]{1,60}: (?:\d{1,12}(?:\.\d{1,3})?|ok|fail|skipped)$/;

/** Las líneas publicables de una salida, y cuántas se descartaron. */
export function filterOutput(text: string): { shown: string[]; hidden: number } {
  const shown: string[] = [];
  let hidden = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    if (PUBLIC_LINE.test(line)) shown.push(line);
    else hidden++;
  }
  return { shown, hidden };
}

async function main(argv: readonly string[]): Promise<number> {
  const separator = argv.indexOf("--");
  const command = separator === -1 ? [] : argv.slice(separator + 1);
  if (command.length === 0) {
    console.log("quiet.usage: fail");
    return 2;
  }
  const [file = "", ...args] = command;
  const chunks: Buffer[] = [];
  const child = spawn(file, args, { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
  const code = await new Promise<number>((resolve) => {
    child.on("error", () => {
      resolve(127);
    });
    child.on("close", (exit, signal) => {
      resolve(signal === null ? (exit ?? 1) : 1);
    });
  });
  const { shown, hidden } = filterOutput(Buffer.concat(chunks).toString("utf8"));
  for (const line of shown) console.log(line);
  console.log(`quiet.hidden_lines: ${String(hidden)}`);
  if (code !== 0) console.log(`quiet.exit_code: ${String(code)}`);
  return code;
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  process.exitCode = await main(process.argv.slice(2));
}
