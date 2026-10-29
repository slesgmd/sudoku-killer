// Simulador de la puntuación (`docs/puntuacion.md`): repite la validación de los parámetros
// vigentes, 10 000 partidas sobre los 2000 puzzles del banco con la semilla base 2, y exige las metas.
// T-19.6: pedir una pista no da más puntos que no pedirla (efecto neto frente al placebo ≤ 0), y
// tampoco compensa quitarle a otro su celda. T-36.6: adivinar tiene EV negativo frente a deducir (el
// nivel 2 con su intervalo de confianza; el nivel 3, en media), P y H cumplen sus reglas y β no pasa
// del 20 % de los puntos.
//
// La semilla es fija, a diferencia de los otros corpus: la media del nivel 3 queda cerca del límite
// (−2,4 con 10 000 partidas), así que con otras semillas o menos partidas el ruido decide su signo
// (con 1000 partidas y la semilla 1 da +5,7). La simulación es determinista: esta prueba falla si un
// cambio del código mueve la validación. La equidad y el Spearman necesitan el aporte con réplicas,
// que es caro; los mide `scoring:simulate`. No corre en la CI de cada push.
import { availableParallelism } from "node:os";
import { PARAMS_V1 } from "@sudoku-killer/scoring";
import { describe, expect, it } from "vitest";
import { evaluate, ownScorer, reliability } from "../scripts/scoring-sim/metrics.ts";
import { runSimulation } from "../scripts/scoring-sim/run.ts";
import { checkTargets } from "../scripts/scoring-sim/targets.ts";
import { readManifest } from "./helpers/bank.ts";

/** La validación de la puntuación (`docs/puntuacion.md`, sección 9): semilla base 2 y 10 000 partidas. */
const VALIDATION = { baseSeed: 2, games: 10_000 } as const;

describe("scoring simulation corpus", () => {
  it(
    "T-19.6 and T-36.6: the required targets hold on the validation games",
    { timeout: 3_600_000 },
    async () => {
      const run = await runSimulation({
        manifest: readManifest(),
        ...VALIDATION,
        robustnessEvery: 0,
        workers: Math.max(1, availableParallelism() - 1),
        replicates: 0,
      });
      const metrics = evaluate(run.records, ownScorer(PARAMS_V1), PARAMS_V1);
      const required = checkTargets(metrics, reliability(run.records), PARAMS_V1).filter(
        (check) => check.required,
      );
      for (const check of required) {
        console.log(`${check.pass ? "✓" : "✗"} ${check.name}: ${check.value}`);
      }
      console.log(
        `Scoring simulation: ${String(run.records.length)} games in ${(run.wallMs / 1000).toFixed(0)} s`,
      );
      for (const check of required) {
        expect(check.pass, `${check.name}: ${check.value}`).toBe(true);
      }
    },
  );
});
