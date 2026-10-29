// Bloques de experimentos del simulador (`docs/puntuacion.md`). Cada puzzle del banco se juega 5
// veces: 3 en el bloque A (mesas al azar, con el aporte contrafáctico y la rama sin adivinar), 1 en
// el B (duelo de un veloz y un lógico de igual velocidad) y 1 en el C (ramas con y sin una pista
// forzada). Todo sale de la semilla de la partida, así que el resultado no depende de en qué hilo
// ni en qué orden se simula.
import type { Difficulty } from "@sudoku-killer/protocol";
import type { ScoringEvent } from "@sudoku-killer/scoring";
import { simulateGame, type BotResult, type Outcome, type SimPuzzle } from "./game.ts";
import {
  mixSeed,
  randomBot,
  simRng,
  worldModel,
  type BotSpec,
  type ProfileName,
  type SimRng,
  type WorldModel,
} from "./world.ts";

export const GAMES_PER_PUZZLE = 5;
export type Block = "A" | "B" | "C";

export function blockOf(game: number): Block {
  const slot = game % GAMES_PER_PUZZLE;
  return slot < 3 ? "A" : slot === 3 ? "B" : "C";
}

/** Si el equipo no termina sin un jugador, su tiempo cuenta como esta cantidad de veces el real. */
export const COUNTERFACTUAL_CAP = 3;

export interface PlayedGame {
  readonly log: readonly ScoringEvent[];
  /** Índices en `log` de las adivinanzas. */
  readonly guesses: readonly number[];
  /** El nivel de cada acierto al decidir jugarlo (0 en lo demás). */
  readonly decidedLevels: readonly number[];
  readonly end: number;
  readonly outcome: Outcome;
  readonly bots: readonly BotResult[];
}

export interface Replicate {
  readonly end: number;
  readonly withoutSeat: readonly (number | null)[];
}

export interface GameRecord {
  readonly game: number;
  readonly puzzleSeed: number;
  readonly difficulty: Difficulty;
  readonly block: Block;
  readonly profile: ProfileName;
  readonly bots: readonly BotSpec[];
  readonly full: PlayedGame;
  /**
   * A y B: el aporte contrafáctico, en réplicas con otro azar del mundo (misma mesa y puzzle). En
   * cada réplica ganada, el tiempo del equipo y, por asiento, el tiempo sin él (con la cota); en B,
   * solo los asientos del duelo (`null` en los demás). La primera réplica es la partida `full`.
   */
  readonly aporte?: readonly Replicate[];
  /** A: la misma partida con los adivinadores deduciendo en vez de adivinar (si hay alguno). */
  readonly noGuess?: PlayedGame;
  /** B: los asientos del duelo. */
  readonly duel?: { readonly fast: number; readonly logic: number };
  /** C: la rama con la pista forzada y su momento; `full` es la rama sin pista. */
  readonly hint?: {
    readonly seat: number;
    readonly steal: boolean;
    readonly withHint: PlayedGame;
    /** La misma espera que la pista, sin la pista: la desviación de la partida por sí sola. */
    readonly placebo: PlayedGame;
    readonly cell: number;
    readonly victim: number | null;
  };
}

const played = ({
  log,
  guesses,
  decidedLevels,
  end,
  outcome,
  bots,
}: ReturnType<typeof simulateGame>): PlayedGame => ({
  log,
  guesses,
  decidedLevels,
  end,
  outcome,
  bots,
});

function tableSize(rng: SimRng): number {
  return 2 + rng.int(5);
}

function shuffled<T>(rng: SimRng, list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const value = list[i] as T;
    list[i] = list[j] as T;
    list[j] = value;
  }
  return list;
}

/**
 * Réplicas del aporte contrafáctico: la partida con otro azar del mundo y, para cada asiento
 * elegido, sin él. Solo se guardan las réplicas que el equipo completo gana.
 */
function replicates(
  sim: SimPuzzle,
  bots: readonly BotSpec[],
  seed: number,
  world: WorldModel,
  full: ReturnType<typeof simulateGame>,
  count: number,
  measured: (seat: number) => boolean,
): Replicate[] {
  const result: Replicate[] = [];
  for (let r = 0; r < count; r++) {
    const replicaSeed = r === 0 ? seed : mixSeed(seed, 0xbeef + r);
    const replica = r === 0 ? full : simulateGame({ sim, bots, seed: replicaSeed, world });
    if (replica.outcome !== "victory") continue;
    const horizon = COUNTERFACTUAL_CAP * replica.end;
    const withoutSeat = bots.map((_, absent) => {
      if (!measured(absent)) return null;
      const result = simulateGame({ sim, bots, seed: replicaSeed, world, absent, horizon });
      return result.outcome === "victory" ? Math.min(result.end, horizon) : horizon;
    });
    result.push({ end: replica.end, withoutSeat });
  }
  return result;
}

/** Simula la partida `game` (con sus ramas) sobre el puzzle, con el perfil de tiempos dado. */
export function runGame(
  sim: SimPuzzle,
  game: number,
  baseSeed: number,
  profile: ProfileName,
  count: number,
): GameRecord {
  const seed = mixSeed(baseSeed, game);
  const rng = simRng(mixSeed(seed, 0x7ab1e));
  const world = worldModel(profile);
  const block = blockOf(game);
  const size = tableSize(rng);
  const header = {
    game,
    puzzleSeed: sim.seed,
    difficulty: sim.difficulty,
    block,
    profile,
  } as const;

  if (block === "A") {
    const bots = Array.from({ length: size }, () => randomBot(rng));
    const full = simulateGame({ sim, bots, seed, world });
    const aporte = replicates(sim, bots, seed, world, full, count, () => true);
    const noGuess = bots.some(({ kind }) => kind === "guesser")
      ? played(simulateGame({ sim, bots, seed, world, noGuess: true }))
      : undefined;
    return {
      ...header,
      bots,
      full: played(full),
      aporte,
      ...(noGuess ? { noGuess } : {}),
    };
  }

  if (block === "B") {
    const speed = rng.lognormal(0.35);
    const fastBot: BotSpec = { kind: "fast", speed, skill: 5, hintProb: 0 };
    const logicBot: BotSpec = { kind: "logic", speed, skill: 5, hintProb: 0 };
    const others = Array.from({ length: size - 2 }, () => randomBot(rng));
    const bots = shuffled(rng, [fastBot, logicBot, ...others]);
    const fast = bots.indexOf(fastBot);
    const logic = bots.indexOf(logicBot);
    const full = simulateGame({ sim, bots, seed, world });
    const aporte = replicates(
      sim,
      bots,
      seed,
      world,
      full,
      count,
      (s) => s === fast || s === logic,
    );
    return { ...header, bots, full: played(full), aporte, duel: { fast, logic } };
  }

  // C: sin pistas espontáneas, para que la única pista sea la forzada.
  const bots = Array.from({ length: size }, () => ({ ...randomBot(rng), hintProb: 0 }));
  const seat = rng.int(size);
  const afterFilled = 0.2 + 0.5 * rng.float();
  const steal = rng.float() < 0.5;
  const branch = (mode: "hint" | "none" | "placebo") =>
    simulateGame({ sim, bots, seed, world, forcedHint: { seat, afterFilled, steal, mode } });
  const without = branch("none");
  const withHint = branch("hint");
  const placebo = branch("placebo");
  const forced = withHint.forced;
  return {
    ...header,
    bots,
    full: played(without),
    ...(forced
      ? {
          hint: {
            seat,
            steal,
            withHint: played(withHint),
            placebo: played(placebo),
            cell: forced.cell,
            victim: forced.victim,
          },
        }
      : {}),
  };
}
