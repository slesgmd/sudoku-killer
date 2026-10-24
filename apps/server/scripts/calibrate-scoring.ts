// Calibración de la puntuación (F6d, `docs/puntuacion.md`): simula una vez y recalcula los puntajes
// con una grilla de pesos entre v1 (1/1,5/2/3/4) y 1/2/3/4/5, con β de 1 o 2. P es el mínimo que
// cumple la condición para adivinadores de nivel ≤ 2 más un margen, y H = B·w(5) + 10. Imprime cada
// combinación con sus metas y escribe la grilla en JSON.
//
//   pnpm --filter @sudoku-killer/server scoring:calibrate [--games 10000] [--base-seed 1]
//     [--replicates 4] [--workers N] [--margin 10] [--out carpeta]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseScoringParams, type ScoringParams } from "@sudoku-killer/scoring";
import { manifestSchema } from "../src/puzzles/bank.ts";
import { evaluate, ownScorer, reliability } from "./scoring-sim/metrics.ts";
import { runSimulation } from "./scoring-sim/run.ts";
import { checkTargets, guessThreshold, type Check } from "./scoring-sim/targets.ts";

const { values } = parseArgs({
  options: {
    games: { type: "string", default: "10000" },
    "base-seed": { type: "string", default: "1" },
    replicates: { type: "string", default: "4" },
    workers: { type: "string", default: String(Math.max(1, availableParallelism() - 1)) },
    margin: { type: "string", default: "10" },
    out: { type: "string", default: join(tmpdir(), "sudoku-killer-scoring-sim") },
  },
});

const BASE = 10;
const W2 = [1.5, 2];
const W3 = [2, 2.5, 3];
const W4 = [3, 3.5, 4];
const W5 = [4, 4.5, 5];
const BETAS = [1, 2];
const margin = Number(values.margin);

/** P: el primer múltiplo de 5 que supera B·(w(5) + w(2)) por al menos el margen. */
function penaltyFor(params: Omit<ScoringParams, "mistakePenalty">): number {
  // La grilla cubrió adivinadores de nivel ≤ 2; el valor final de P cubre el nivel 3 (targets.ts).
  const threshold = guessThreshold({ ...params, mistakePenalty: 0 }, 2);
  return Math.ceil((threshold + margin) / 5) * 5;
}

const grid: ScoringParams[] = [];
for (const w2 of W2) {
  for (const w3 of W3) {
    for (const w4 of W4) {
      for (const w5 of W5) {
        if (!(w2 <= w3 && w3 <= w4 && w4 <= w5)) continue;
        for (const beta of BETAS) {
          const weights = [1, w2, w3, w4, w5];
          const partial = {
            version: `w${weights.join("/")}-b${String(beta)}`,
            base: BASE,
            weights,
            closureBonus: beta,
            hintPenalty: BASE * w5 + 10,
          };
          grid.push(parseScoringParams({ ...partial, mistakePenalty: penaltyFor(partial) }));
        }
      }
    }
  }
}

const manifest = manifestSchema.parse(
  JSON.parse(
    readFileSync(fileURLToPath(new URL("../bank/manifest.json", import.meta.url)), "utf8"),
  ),
);
console.log(`Simulando para calibrar (${values.games} partidas, ${values.replicates} réplicas)…`);
const run = await runSimulation({
  manifest,
  games: Number(values.games),
  baseSeed: Number(values["base-seed"]),
  robustnessEvery: 0,
  workers: Number(values.workers),
  replicates: Number(values.replicates),
});
console.log(
  `Simulado en ${(run.wallMs / 60_000).toFixed(1)} min; ${String(grid.length)} combinaciones.`,
);
const reliable = reliability(run.records);

interface Row {
  readonly params: ScoringParams;
  readonly checks: Check[];
  readonly passed: number;
  readonly equityGap: number;
  readonly duelWin: number;
  readonly duelAporte: number;
}
const rows: Row[] = grid.map((params) => {
  const metrics = evaluate(run.records, ownScorer(params), params);
  const checks = checkTargets(metrics, reliable, params);
  return {
    params,
    checks,
    passed: checks.filter(({ pass }) => pass).length,
    equityGap: metrics.equity.maxGap,
    duelWin: metrics.equity.duel.winRate,
    duelAporte: metrics.equity.duel.aporteWinRate,
  };
});
rows.sort((a, b) => b.passed - a.passed || a.equityGap - b.equityGap);

for (const row of rows) {
  const failed = row.checks.filter(({ pass }) => !pass).map(({ name }) => name);
  console.log(
    `${row.params.version.padEnd(22)} P ${String(row.params.mistakePenalty).padStart(3)} H ${String(row.params.hintPenalty).padStart(3)} · metas ${String(row.passed)}/${String(row.checks.length)} · equidad ${row.equityGap.toFixed(1)} · veloz gana ${row.duelWin.toFixed(1)} % (aporte ${row.duelAporte.toFixed(1)} %)${failed.length > 0 ? ` · falla: ${failed.join("; ")}` : ""}`,
  );
}
const best = rows[0];
if (best) {
  console.log(`\nMejor: ${best.params.version}`);
  for (const check of best.checks) {
    console.log(`  ${check.pass ? "✓" : "✗"} ${check.name}: ${check.value} (meta ${check.target})`);
  }
}
mkdirSync(values.out, { recursive: true });
const file = join(values.out, `calibration-seed${values["base-seed"]}.json`);
writeFileSync(file, JSON.stringify({ reliability: reliable, rows }, null, 2));
console.log(`\nGrilla: ${file}`);
