#!/usr/bin/env node
// Quita las atribuciones de IA de un mensaje de commit (hook commit-msg de Husky y reescritura del
// historial). Uso: `node scripts/strip-attribution.mjs <archivo>` reescribe el archivo; sin
// argumentos, filtra de la entrada estándar a la salida estándar.
import { readFileSync, writeFileSync } from "node:fs";
import { STRIP_PATTERNS } from "./attribution-patterns.mjs";

export function stripAttribution(message) {
  const lines = message
    .split(/\r?\n/)
    .filter((line) => !STRIP_PATTERNS.some((re) => re.test(line)));
  while (lines.length > 0 && lines.at(-1)?.trim() === "") lines.pop();
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

const [file] = process.argv.slice(2);
if (file) {
  writeFileSync(file, stripAttribution(readFileSync(file, "utf8")));
} else {
  process.stdout.write(stripAttribution(readFileSync(0, "utf8")));
}
