#!/usr/bin/env node
// Quita de un mensaje de commit las líneas que la política de commits no admite (hook commit-msg de
// Husky). Uso: `node scripts/commit-msg-filter.mjs <archivo>` reescribe el archivo; sin
// argumentos, filtra de la entrada estándar a la salida estándar.
import { readFileSync, writeFileSync } from "node:fs";
import { STRIP_PATTERNS } from "./commit-policy-patterns.mjs";

export function filterCommitMessage(message) {
  const lines = message
    .split(/\r?\n/)
    .filter((line) => !STRIP_PATTERNS.some((re) => re.test(line)));
  while (lines.length > 0 && lines.at(-1)?.trim() === "") lines.pop();
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

const [file] = process.argv.slice(2);
if (file) {
  writeFileSync(file, filterCommitMessage(readFileSync(file, "utf8")));
} else {
  process.stdout.write(filterCommitMessage(readFileSync(0, "utf8")));
}
