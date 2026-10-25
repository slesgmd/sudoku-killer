// Clave de acceso del grupo (F12, S-02): genera una clave nueva o toma una propia, y escribe la
// clave, el enlace de invitación y el valor de ACCESS_KEY_HASH para el panel del hosting. Se corre
// solo en la computadora de quien administra el grupo, nunca en la CI: la salida es secreta.
//   pnpm --filter @sudoku-killer/server access:key [--own] [--web https://…]
// Con `--own` pide la clave sin mostrarla en la pantalla.
import { randomInt } from "node:crypto";
import { stdin, stdout } from "node:process";
import { isValidAccessKey, normalizeAccessKey } from "@sudoku-killer/protocol";
import { hashAccessKey } from "../src/infra/access.ts";
import { isMain } from "./is-main.ts";

/** Crockford base32: sin I, L, O ni U (no se confunden al dictarla). */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const DEFAULT_WEB = "https://sudoku-killer-lima.onrender.com";

/** 16 caracteres al azar (80 bits) en cuatro grupos: `XXXX-XXXX-XXXX-XXXX`. */
export function generateAccessKey(next: (max: number) => number = randomInt): string {
  const chars = Array.from({ length: 16 }, () => ALPHABET.charAt(next(ALPHABET.length)));
  return [0, 4, 8, 12].map((start) => chars.slice(start, start + 4).join("")).join("-");
}

/** El enlace de invitación: la clave en el fragmento (`#k=`), que no llega a ningún servidor. */
export function invitationLink(web: string, key: string): string {
  return `${new URL(web).origin}/#k=${encodeURIComponent(key)}`;
}

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    stdout.write(prompt);
    let value = "";
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          stdin.off("data", onData);
          if (stdin.isTTY) stdin.setRawMode(false);
          stdin.pause();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") process.exit(130);
        value = char === "\u007f" ? value.slice(0, -1) : value + char;
      }
    };
    stdin.on("data", onData);
    stdin.resume();
  });
}

async function main(argv: readonly string[]): Promise<number> {
  const webIndex = argv.indexOf("--web");
  const web = webIndex === -1 ? DEFAULT_WEB : (argv[webIndex + 1] ?? DEFAULT_WEB);
  const key = argv.includes("--own")
    ? await readHidden("Clave del grupo (no se muestra): ")
    : generateAccessKey();
  if (!isValidAccessKey(normalizeAccessKey(key))) {
    console.error("La clave debe tener entre 12 y 64 caracteres, sin contar espacios ni guiones.");
    return 1;
  }
  console.log(`Clave del grupo: ${key}`);
  console.log(`Enlace de invitación: ${invitationLink(web, key)}`);
  console.log(`ACCESS_KEY_HASH (solo en el panel del hosting): ${hashAccessKey(key)}`);
  return 0;
}

if (isMain(import.meta.url, process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
