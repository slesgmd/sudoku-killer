// Ejecución del simulador (F6): reparte los puzzles del banco en tareas, las simula en hilos de
// trabajo (o en el hilo actual) y junta los registros en orden de partida. Cada partida sale solo de
// su semilla, así que el resultado no depende de cuántos hilos haya ni del orden de las tareas.
import { Worker } from "node:worker_threads";
import { DIFFICULTIES } from "@sudoku-killer/protocol";
import type { Manifest, ManifestEntry } from "@sudoku-killer/bank";
import { verifyEntry } from "../../src/puzzles/bank.ts";
import { GAMES_PER_PUZZLE, runGame, type GameRecord } from "./experiments.ts";
import { simPuzzle } from "./game.ts";
import type { ProfileName } from "./world.ts";

export interface SimTask {
  readonly entry: ManifestEntry;
  /** Índice del puzzle en el orden intercalado por dificultad: sus partidas son 5·p a 5·p + 4. */
  readonly puzzleIndex: number;
  readonly baseSeed: number;
  readonly profiles: readonly ProfileName[];
  /** Réplicas del aporte contrafáctico por partida. */
  readonly replicates: number;
}

export interface TaskResult {
  readonly records: GameRecord[];
  readonly regenerateMs: number;
  readonly simulateMs: number;
  readonly analyses: number;
  readonly analysisCalls: number;
  readonly analysisMs: number;
}

export function runTask({
  entry,
  puzzleIndex,
  baseSeed,
  profiles,
  replicates,
}: SimTask): TaskResult {
  const start = performance.now();
  const { generated } = verifyEntry(entry);
  const regenerated = performance.now();
  const sim = simPuzzle(entry.seed, entry.difficulty, generated.puzzle, generated.solution);
  const records: GameRecord[] = [];
  for (const profile of profiles) {
    for (let k = 0; k < GAMES_PER_PUZZLE; k++) {
      const game = puzzleIndex * GAMES_PER_PUZZLE + k;
      records.push(runGame(sim, game, baseSeed, profile, replicates));
    }
  }
  return {
    records,
    regenerateMs: regenerated - start,
    simulateMs: performance.now() - regenerated,
    analyses: sim.stats.misses,
    analysisCalls: sim.stats.calls,
    analysisMs: sim.stats.ms,
  };
}

export interface SimOptions {
  readonly manifest: Manifest;
  /** Partidas base (múltiplo de 5): usa `games / 5` puzzles, intercalados por dificultad. */
  readonly games: number;
  readonly baseSeed: number;
  /**
   * Cada cuántos bloques de 4 puzzles (uno por dificultad) se repiten sus partidas con los perfiles
   * alternativos (0: ninguno).
   */
  readonly robustnessEvery: number;
  /** 0: en el hilo actual. */
  readonly workers: number;
  /** Réplicas del aporte contrafáctico por partida (bloques A y B). */
  readonly replicates: number;
  readonly onProgress?: (done: number, total: number) => void;
}

export interface SimRun {
  /** En orden de perfil y de partida. */
  readonly records: GameRecord[];
  readonly cpuMs: { regenerate: number; simulate: number; analysis: number };
  readonly analyses: number;
  readonly analysisCalls: number;
  readonly wallMs: number;
}

const SOURCE_CONDITION = "@sudoku-killer/source";

const PROFILE_ORDER: readonly ProfileName[] = ["base", "flat", "steep"];

export function tasksOf({
  manifest,
  games,
  baseSeed,
  robustnessEvery,
  replicates,
}: SimOptions): SimTask[] {
  if (games % GAMES_PER_PUZZLE !== 0) throw new RangeError("games must be a multiple of 5");
  const puzzles = games / GAMES_PER_PUZZLE;
  // Intercalados por dificultad (fácil, media, difícil, experto, fácil…), para que cualquier
  // cantidad de partidas tenga las 4 dificultades por igual: el manifiesto está en orden de semilla
  // y los expertos llegan mucho más tarde.
  const byDifficulty = DIFFICULTIES.map((d) => manifest.entries.filter((e) => e.difficulty === d));
  const interleaved = byDifficulty[0]?.flatMap((_, i) => byDifficulty.map((list) => list[i])) ?? [];
  const ordered = interleaved.filter((entry) => entry !== undefined);
  if (puzzles > ordered.length) throw new RangeError("Not enough puzzles in the bank");
  return ordered.slice(0, puzzles).map((entry, puzzleIndex) => ({
    entry,
    puzzleIndex,
    baseSeed,
    replicates,
    profiles:
      // Por bloques de 4 puzzles seguidos (uno de cada dificultad).
      robustnessEvery > 0 && Math.floor(puzzleIndex / DIFFICULTIES.length) % robustnessEvery === 0
        ? PROFILE_ORDER
        : (["base"] as const),
  }));
}

function sortRecords(records: GameRecord[]): GameRecord[] {
  return records.sort(
    (a, b) =>
      PROFILE_ORDER.indexOf(a.profile) - PROFILE_ORDER.indexOf(b.profile) || a.game - b.game,
  );
}

export async function runSimulation(options: SimOptions): Promise<SimRun> {
  const tasks = tasksOf(options);
  const start = performance.now();
  const results: TaskResult[] = [];
  if (options.workers === 0) {
    for (const task of tasks) {
      results.push(runTask(task));
      options.onProgress?.(results.length, tasks.length);
    }
  } else {
    // Las tareas de los puzzles expertos (más caras) primero, para repartir mejor la carga.
    const queue = [...tasks].sort(
      (a, b) => Number(b.entry.difficulty === "expert") - Number(a.entry.difficulty === "expert"),
    );
    await Promise.all(
      Array.from({ length: Math.min(options.workers, queue.length) }, async () => {
        // Los hilos cargan las fuentes de los paquetes, también desde un proceso que no tenga la
        // condición (las pruebas).
        const worker = new Worker(new URL("./worker.ts", import.meta.url), {
          execArgv: [...new Set([...process.execArgv, `--conditions=${SOURCE_CONDITION}`])],
        });
        try {
          for (let task = queue.shift(); task; task = queue.shift()) {
            const current = task;
            results.push(
              await new Promise<TaskResult>((resolve, reject) => {
                worker.once("message", resolve);
                worker.once("error", reject);
                worker.postMessage(current);
              }),
            );
            worker.removeAllListeners("error");
            options.onProgress?.(results.length, tasks.length);
          }
        } finally {
          await worker.terminate();
        }
      }),
    );
  }
  const sum = (pick: (r: TaskResult) => number) => results.reduce((t, r) => t + pick(r), 0);
  return {
    records: sortRecords(results.flatMap(({ records }) => records)),
    cpuMs: {
      regenerate: sum((r) => r.regenerateMs),
      simulate: sum((r) => r.simulateMs),
      analysis: sum((r) => r.analysisMs),
    },
    analyses: sum((r) => r.analyses),
    analysisCalls: sum((r) => r.analysisCalls),
    wallMs: performance.now() - start,
  };
}
