// Simulador de la puntuación (F6, `docs/puntuacion.md`), versión chica para la CI. La simulación es
// determinista: da lo mismo en el hilo actual, en otro orden y en 2 hilos (T-36.6). Las partidas
// cumplen las reglas que tocan la puntuación: vidas y espectadores (R-03), una sola jugada por celda
// (R-05), a lo sumo 3 pistas (R-19) y niveles entre 1 y 5 (T-20.5). T-19.6, versión reducida: con
// semillas fijas, pedir la pista da en media menos puntos que la rama placebo. La versión completa está en
// `scoring-sim.corpus.test.ts`.
import { PARAMS_V1 } from "@sudoku-killer/scoring";
import { describe, expect, it } from "vitest";
import { hints, ownScorer } from "../scripts/scoring-sim/metrics.ts";
import { runSimulation, runTask, tasksOf } from "../scripts/scoring-sim/run.ts";
import { readManifest } from "./helpers/bank.ts";

const OPTIONS = {
  games: 20,
  baseSeed: 7,
  robustnessEvery: 2,
  workers: 0,
  replicates: 2,
} as const;

describe("scoring simulator", () => {
  const manifest = readManifest();

  it(
    "T-36.6: deterministic, in any order and in worker threads",
    { timeout: 120_000 },
    async () => {
      const inline = await runSimulation({ manifest, ...OPTIONS });
      const tasks = tasksOf({ manifest, ...OPTIONS });
      const reversed = tasks.reverse().flatMap((task) => runTask(task).records);
      const sortKey = (r: { profile: string; game: number }) =>
        `${r.profile}:${String(r.game).padStart(6, "0")}`;
      expect([...reversed].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))).toEqual(
        [...inline.records].sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
      );
      const threaded = await runSimulation({ manifest, ...OPTIONS, workers: 2 });
      expect(threaded.records).toEqual(inline.records);

      const difficulties = new Set(inline.records.map((r) => r.difficulty));
      expect(difficulties.size).toBe(4);
      expect(new Set(inline.records.map((r) => r.profile))).toEqual(
        new Set(["base", "flat", "steep"]),
      );

      for (const record of inline.records) {
        const games = [record.full, record.noGuess, record.hint?.withHint].filter(
          (g) => g !== undefined,
        );
        for (const game of games) {
          const placed = new Set<number>();
          let hints = 0;
          const mistakes = new Map<string, number>();
          for (const event of game.log) {
            expect(placed.has(event.cell), `game ${String(record.game)}`).toBe(false);
            if (event.type === "mistake") {
              mistakes.set(event.playerId, (mistakes.get(event.playerId) ?? 0) + 1);
              continue;
            }
            placed.add(event.cell);
            if (event.type === "hint") hints++;
            else {
              expect(event.levelToDeduce).toBeGreaterThanOrEqual(1);
              expect(event.levelToDeduce).toBeLessThanOrEqual(5);
            }
          }
          expect(hints).toBeLessThanOrEqual(3);
          game.bots.forEach(({ livesLeft }, seat) => {
            expect(livesLeft).toBeGreaterThanOrEqual(0);
            expect(livesLeft).toBe(Math.max(0, 3 - (mistakes.get(String(seat)) ?? 0)));
          });
          if (game.outcome === "victory")
            expect(game.bots.some(({ livesLeft }) => livesLeft > 0)).toBe(true);
          if (game.outcome === "defeat")
            expect(game.bots.every(({ livesLeft }) => livesLeft === 0)).toBe(true);
        }
      }

      // T-19.6 (reducida): con la pista, el propio puntaje queda en media por debajo del placebo. Rama
      // por rama no se puede exigir: la partida se desvía y el ruido va en los dos sentidos.
      const branches = inline.records.filter((record) => record.hint);
      expect(branches.length).toBeGreaterThan(0);
      const effect = hints(branches, ownScorer(PARAMS_V1));
      expect(effect.netSelf.mean).toBeLessThan(0);
    },
  );
});
