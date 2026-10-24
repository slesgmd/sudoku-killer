// Genera el manifiesto del banco de puzzles (F5, ADR 0006): recorre semillas en orden, califica y
// clasifica cada puzzle, descarta los que exceden las técnicas y se queda con los primeros N de cada
// dificultad. Imprime las distribuciones y los tiempos para docs/dificultad.md.
//
//   pnpm --filter @sudoku-killer/server bank:generate [--base-seed 1] [--per-difficulty 500] [--out bank/manifest.json]
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DIFFICULTIES, type Difficulty } from "@sudoku-killer/protocol";
import {
  DEFAULT_PER_DIFFICULTY,
  buildBank,
  serializeManifest,
  type BankCandidate,
} from "../src/puzzles/bank.ts";

const { values } = parseArgs({
  options: {
    "base-seed": { type: "string", default: "1" },
    "per-difficulty": { type: "string", default: String(DEFAULT_PER_DIFFICULTY) },
    out: {
      type: "string",
      default: fileURLToPath(new URL("../bank/manifest.json", import.meta.url)),
    },
  },
});
const baseSeed = Number(values["base-seed"]);
const perDifficulty = Number(values["per-difficulty"]);
const out = values.out;

const quantile = (sorted: readonly number[], q: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN;
const spread = (list: readonly number[]): string => {
  const sorted = [...list].sort((a, b) => a - b);
  return `mediana ${String(quantile(sorted, 0.5))}, p95 ${String(quantile(sorted, 0.95))}, máx. ${String(sorted.at(-1))}`;
};
const histogram = (list: readonly number[], cap: number): string => {
  const counts = new Map<number, number>();
  for (const value of list)
    counts.set(Math.min(value, cap), (counts.get(Math.min(value, cap)) ?? 0) + 1);
  return [...counts]
    .sort(([a], [b]) => a - b)
    .map(
      ([value, count]) => `${value === cap ? `${String(cap)}+` : String(value)}: ${String(count)}`,
    )
    .join(", ");
};

const all: BankCandidate[] = [];
const { manifest, stats } = buildBank({
  baseSeed,
  perDifficulty,
  onCandidate: (candidate) => {
    all.push(candidate);
    if (all.length % 1000 === 0) process.stderr.write(`${String(all.length)} semillas\n`);
  },
});
writeFileSync(out, serializeManifest(manifest));

const inBank = new Set(manifest.entries.map(({ seed }) => seed));
const byDifficulty = new Map<Difficulty, BankCandidate[]>(DIFFICULTIES.map((d) => [d, []]));
for (const candidate of all) {
  if (candidate.difficulty !== null && inBank.has(candidate.seed)) {
    byDifficulty.get(candidate.difficulty)?.push(candidate);
  }
}
const levelThree = (c: BankCandidate): number => c.result.stepsByLevel[3] ?? 0;
const levels = (list: readonly BankCandidate[]): string =>
  histogram(
    list.map((c) => c.result.maxLevel),
    6,
  );

const lines = [
  `Manifiesto: ${out}`,
  `Semillas ${String(baseSeed)} a ${String(baseSeed + stats.seeds - 1)}: ${String(stats.seeds)} candidatos, ${String(stats.excluded)} excluidos (${((100 * stats.excluded) / stats.seeds).toFixed(1)} %), ${String(manifest.entries.length)} en el banco`,
  `Tiempo: ${(stats.totalMs / 60_000).toFixed(1)} min en total, ${stats.msPerSeed.toFixed(1)} ms por candidato; candidatos internos del generador: ${String(stats.generatorCandidates)}`,
  `Todas las semillas evaluadas, nivel máximo (6 = exceden): ${levels(all)}`,
  "Por dificultad (semillas hasta completarla / que califican en total / en el banco):",
  ...DIFFICULTIES.map((d) => {
    const list = byDifficulty.get(d) ?? [];
    return [
      `  ${d}: ${String(stats.filledAfter[d])} / ${String(stats.qualifying[d])} (${((100 * stats.qualifying[d]) / stats.seeds).toFixed(1)} %) / ${String(list.length)}`,
      `    nivel máximo ${levels(list)}; pasos ${spread(list.map((c) => c.result.steps))}; pasos de nivel 3 ${histogram(list.map(levelThree), 6)}`,
      `    pasos por nivel 1-5 (total): ${[1, 2, 3, 4, 5].map((l) => String(list.reduce((s, c) => s + (c.result.stepsByLevel[l] ?? 0), 0))).join(" / ")}; con números iniciales de unicidad: ${String(list.filter((c) => c.generated.givensReason === "uniqueness").length)}`,
    ].join("\n");
  }),
];
console.log(lines.join("\n"));
