// Tiempo de carga de un puzzle en el servidor simulado: regenerar la semilla del manifiesto
// (`regenerateSeed`) y calcular su hash, por dificultad. Mide en Node; en el navegador, el simulador
// escribe el tiempo de cada carga en la consola.
// Uso: `pnpm --filter @sudoku-killer/web sim:measure [semillas por dificultad]` (por defecto 50).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalPuzzle, manifestSchema, regenerateSeed } from "@sudoku-killer/bank";
import { DIFFICULTIES } from "@sudoku-killer/protocol";

const perDifficulty = Number(process.argv[2] ?? 50);
const manifest = manifestSchema.parse(
  JSON.parse(readFileSync(new URL("../../server/bank/manifest.json", import.meta.url), "utf8")),
);

const quantile = (sorted: readonly number[], q: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;

console.log(`Load time per puzzle (regenerate + hash), ${String(perDifficulty)} seeds each:`);
for (const difficulty of DIFFICULTIES) {
  const entries = manifest.entries
    .filter((e) => e.difficulty === difficulty)
    .slice(0, perDifficulty);
  const times = entries.map((entry) => {
    const begin = performance.now();
    const { generated } = regenerateSeed(entry.seed);
    createHash("sha256").update(canonicalPuzzle(generated)).digest("hex");
    return performance.now() - begin;
  });
  const sorted = [...times].sort((a, b) => a - b);
  const ms = (value: number) => `${value.toFixed(0)} ms`;
  console.log(
    `  ${difficulty}: median ${ms(quantile(sorted, 0.5))}, p95 ${ms(quantile(sorted, 0.95))}, max ${ms(sorted.at(-1) ?? 0)}`,
  );
}
