// Genera el manifiesto del banco de puzzles (ADR 0006): recorre semillas en orden; cada semilla
// es de una sola dificultad, recibe sus números iniciales y se queda si cumple la banda. Imprime las
// distribuciones y los tiempos para docs/dificultad.md.
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
import { DIFFICULTY_RULES } from "@sudoku-killer/bank";

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

const quantile = (sorted: readonly number[], q: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN;
const spread = (list: readonly number[]): string => {
  const sorted = [...list].sort((a, b) => a - b);
  return `mediana ${String(quantile(sorted, 0.5))}, p95 ${String(quantile(sorted, 0.95))}, máx. ${String(sorted.at(-1))}`;
};
const histogram = (list: readonly number[], cap: number): string => {
  const counts = new Map<number, number>();
  for (const value of list) {
    const key = Math.min(value, cap);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .sort(([a], [b]) => a - b)
    .map(
      ([value, count]) => `${value === cap ? `${String(cap)}+` : String(value)}: ${String(count)}`,
    )
    .join(", ");
};
/** Nivel máximo, con 6 para lo que excede las técnicas. */
const levelOf = (c: BankCandidate): number =>
  c.result.status === "solved" ? c.result.maxLevel : 6;
const REASONS = ["none", "difficulty", "uniqueness"] as const;

const all: BankCandidate[] = [];
const { manifest, stats } = buildBank({
  baseSeed,
  perDifficulty,
  onCandidate: (candidate) => {
    all.push(candidate);
    if (all.length % 1000 === 0) process.stderr.write(`${String(all.length)} candidatos\n`);
  },
});
writeFileSync(values.out, serializeManifest(manifest));

const lines = [
  `Manifiesto: ${values.out}`,
  `Semillas ${String(baseSeed)} a ${String(stats.lastSeed)}: ${String(all.length)} candidatos evaluados, ${String(manifest.entries.length)} en el banco, ${(stats.totalMs / 60_000).toFixed(1)} min en total`,
  "Por dificultad (números iniciales / candidatos / aceptados / tasa / ms por candidato):",
  ...DIFFICULTIES.map((d: Difficulty) => {
    const s = stats.byDifficulty[d];
    const own = all.filter((c) => c.difficulty === d);
    const kept = own.filter((c) => c.accepted);
    return [
      `  ${d}: ${String(DIFFICULTY_RULES[d].givens)} / ${String(s.candidates)} / ${String(s.accepted)} / ${((100 * s.accepted) / Math.max(1, s.candidates)).toFixed(1)} % / ${s.msPerCandidate.toFixed(1)} ms`,
      `    todos los candidatos, nivel máximo (6 = exceden): ${histogram(own.map(levelOf), 6)}`,
      `    en el banco: nivel máximo ${histogram(kept.map(levelOf), 6)}; pasos ${spread(kept.map((c) => c.result.steps))}; pasos de nivel 3 ${histogram(
        kept.map((c) => c.result.stepsByLevel[3] ?? 0),
        6,
      )}`,
      `    pasos por nivel 1-5 (total): ${[1, 2, 3, 4, 5].map((l) => String(kept.reduce((sum, c) => sum + (c.result.stepsByLevel[l] ?? 0), 0))).join(" / ")}`,
      `    números iniciales ${spread(kept.map((c) => c.generated.puzzle.givens.length))}; motivo ${REASONS.map((r) => `${r}: ${String(kept.filter((c) => c.generated.givensReason === r).length)}`).join(", ")}`,
    ].join("\n");
  }),
];
console.log(lines.join("\n"));
