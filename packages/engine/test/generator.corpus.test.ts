// Corpus del generador (F4d, T-20.1 y T-35.1): 1000 puzzles 9×9 generados, cada uno con solución
// única confirmada por A y por B sin presupuesto. Una discrepancia bloquea F4. No corre en la CI de
// cada push: `pnpm test:corpus` en local y el workflow programado `corpus.yml`.
// Semillas: de CORPUS_BASE_SEED (por defecto 1) en adelante; CORPUS_SIZE cambia la cantidad.
import { describe, expect, it } from "vitest";
import { generatePuzzle } from "@sudoku-killer/engine";
import { expectSoundPuzzle } from "./helpers/generated.ts";

const BASE_SEED = Number(process.env["CORPUS_BASE_SEED"] ?? 1);
const SIZE = Number(process.env["CORPUS_SIZE"] ?? 1000);

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN;
}

describe("generator corpus", () => {
  it(
    `${String(SIZE)} puzzles from seed ${String(BASE_SEED)}: unique for A and B`,
    { timeout: 1_800_000 },
    () => {
      expect(Number.isInteger(BASE_SEED) && BASE_SEED >= 0).toBe(true);
      const times: number[] = [];
      const keys = new Set<string>();
      let discarded = 0;
      let candidates = 0;
      let adjustments = 0;
      let withGivens = 0;
      let maxNodesB = 0;

      for (let seed = BASE_SEED; seed < BASE_SEED + SIZE; seed++) {
        try {
          const start = performance.now();
          const generated = generatePuzzle({ seed });
          times.push(performance.now() - start);
          expectSoundPuzzle(generated);
          keys.add(JSON.stringify(generated.puzzle));
          discarded += generated.stats.discarded;
          candidates += generated.stats.candidates;
          adjustments += generated.stats.adjustments;
          if (generated.givensReason === "uniqueness") withGivens++;
          maxNodesB = Math.max(maxNodesB, generated.stats.nodesB);
        } catch (error) {
          throw new Error(`Corpus seed ${String(seed)} failed (add it as a fixed case)`, {
            cause: error,
          });
        }
      }
      expect(keys.size).toBe(SIZE);

      const sorted = [...times].sort((a, b) => a - b);
      const mean = times.reduce((a, b) => a + b, 0) / times.length;
      const ms = (value: number): string => `${value.toFixed(1)} ms`;
      console.log(
        [
          `Corpus: ${String(SIZE)} puzzles 9x9, seeds ${String(BASE_SEED)} to ${String(BASE_SEED + SIZE - 1)}, 0 discrepancies`,
          `Generation time: mean ${ms(mean)}, median ${ms(quantile(sorted, 0.5))}, p90 ${ms(quantile(sorted, 0.9))}, p99 ${ms(quantile(sorted, 0.99))}, max ${ms(sorted.at(-1) ?? NaN)}`,
          `Candidates: ${String(candidates)}, discarded by the node budget: ${String(discarded)} (${((100 * discarded) / candidates).toFixed(2)} %)`,
          `Cage adjustments per puzzle: ${(adjustments / SIZE).toFixed(2)}; with givens for uniqueness: ${String(withGivens)}; max solver B nodes: ${String(maxNodesB)}`,
        ].join("\n"),
      );
    },
  );
});
