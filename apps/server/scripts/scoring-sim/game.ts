// Una partida simulada (F6): eventos discretos en tiempo virtual, con las reglas del modo Normal que
// tocan la puntuación. Vidas y espectadores (R-03), derrota si no queda ningún activo (R-01), celdas
// bloqueadas y jugadas simultáneas (R-05), pistas compartidas (R-19) y descartes públicos de los
// errores. El resultado es el registro de hechos puntuables: se puntúa después con cualquier
// conjunto de parámetros, porque los bots no reaccionan a la puntuación.
import {
  MAX_TECHNIQUE_LEVEL,
  cageIndexByCell,
  digitBit,
  digitsOf,
  layoutOf,
  levelsToDeduce,
  popcount,
  type BoardLevels,
  type Exclusion,
  type KillerPuzzle,
} from "@sudoku-killer/engine";
import type { Difficulty } from "@sudoku-killer/protocol";
import type { ClosedUnit, ScoringEvent, UnitKind } from "@sudoku-killer/scoring";
import { mixSeed, simRng, type BotSpec, type SimRng, type WorldModel } from "./world.ts";

interface Unit extends ClosedUnit {
  readonly cells: readonly number[];
}

/** Un puzzle del banco listo para simular, con sus unidades y un caché de análisis. */
export interface SimPuzzle {
  readonly seed: number;
  readonly difficulty: Difficulty;
  readonly puzzle: KillerPuzzle;
  readonly solution: readonly number[];
  readonly unitsOfCell: readonly (readonly Unit[])[];
  /** `levelsToDeduce` con memoria por estado (dígitos y descartes), compartida entre partidas. */
  readonly analyze: (values: readonly number[], excluded: readonly Exclusion[]) => BoardLevels;
  readonly stats: { calls: number; misses: number; ms: number };
}

export function simPuzzle(
  seed: number,
  difficulty: Difficulty,
  puzzle: KillerPuzzle,
  solution: readonly number[],
): SimPuzzle {
  const layout = layoutOf(puzzle);
  const cageOf = cageIndexByCell(layout.cellCount, puzzle.cages);
  const kinds: readonly [UnitKind, readonly (readonly number[])[]][] = [
    ["row", layout.rows],
    ["col", layout.cols],
    ["box", layout.boxes],
    ["cage", puzzle.cages.map(({ cells }) => cells)],
  ];
  const units: Unit[] = kinds.flatMap(([unit, list]) =>
    list.map((cells, index) => ({ unit, index, cells })),
  );
  const unitsOfCell = Array.from({ length: layout.cellCount }, (_, cell) =>
    units.filter(({ unit, index, cells }) =>
      unit === "cage" ? cageOf[cell] === index : cells.includes(cell),
    ),
  );
  const cache = new Map<string, BoardLevels>();
  const stats = { calls: 0, misses: 0, ms: 0 };
  const analyze = (values: readonly number[], excluded: readonly Exclusion[]): BoardLevels => {
    stats.calls++;
    const key = `${values.join("")}|${excluded.map(({ cell, digit }) => `${String(cell)}.${String(digit)}`).join(",")}`;
    let result = cache.get(key);
    if (!result) {
      const start = performance.now();
      result = levelsToDeduce({ puzzle, values, excluded });
      stats.ms += performance.now() - start;
      stats.misses++;
      cache.set(key, result);
    }
    return result;
  };
  return { seed, difficulty, puzzle, solution, unitsOfCell, analyze, stats };
}

/** Para el bloque de pistas: un jugador pide una pista en un momento elegido (rama con pista). */
export interface ForcedHint {
  readonly seat: number;
  /** La pista se pide en la primera decisión del jugador con esta fracción de celdas llenas. */
  readonly afterFilled: number;
  /** Sobre la celda difícil que otro bot está pensando (el «robo»), si la hay. */
  readonly steal: boolean;
  /**
   * `hint` pide la pista; `none` marca el mismo momento y juega normal; `placebo` espera lo mismo que
   * tarda en pedir la pista y después juega normal (mide cuánto cambia el resultado solo porque la
   * partida se desvía, sin la pista).
   */
  readonly mode: "hint" | "none" | "placebo";
}

export interface GameSetup {
  readonly sim: SimPuzzle;
  readonly bots: readonly BotSpec[];
  readonly seed: number;
  readonly world: WorldModel;
  /** Asiento que no juega (aporte contrafáctico). */
  readonly absent?: number;
  /**
   * Los adivinadores deducen en vez de adivinar (EV de adivinar frente a deducir): sin nada a su
   * alcance, piensan la celda más fácil fuera de él, con el tiempo de su nivel.
   */
  readonly noGuess?: boolean;
  readonly forcedHint?: ForcedHint;
  /** Corta la partida en este tiempo (segundos). */
  readonly horizon?: number;
}

export type Outcome = "victory" | "defeat" | "stalled" | "horizon";

export interface BotResult {
  readonly livesLeft: number;
  readonly guesses: number;
  readonly guessMistakes: number;
  readonly alreadySolved: number;
}

export interface GameResult {
  readonly log: ScoringEvent[];
  /** Tiempo del último bloqueo (victoria), o del fin de la partida. */
  readonly end: number;
  readonly outcome: Outcome;
  readonly bots: readonly BotResult[];
  /** Índices en `log` de las jugadas que fueron adivinanzas. */
  readonly guesses: readonly number[];
  /**
   * Por cada hecho de `log`, el nivel de la celda cuando el jugador decidió jugarla (0 si fue una
   * adivinanza o no es un acierto). El nivel puntuado es el del momento de la jugada.
   */
  readonly decidedLevels: readonly number[];
  /** El momento de la pista forzada: celda, víctima del robo (o `null`) y tiempo. */
  readonly forced: {
    readonly cell: number;
    readonly victim: number | null;
    readonly at: number;
  } | null;
}

type Action =
  | {
      readonly kind: "place";
      readonly time: number;
      readonly cell: number;
      readonly digit: number;
      /** El nivel al decidir; 0 si es una adivinanza. */
      readonly level: number;
    }
  | { readonly kind: "hint"; readonly time: number; readonly cell: number }
  | { readonly kind: "decide"; readonly time: number };

interface Bot {
  readonly seat: number;
  readonly spec: BotSpec;
  readonly rng: SimRng;
  lives: number;
  action: Action | null;
  idle: boolean;
  guesses: number;
  guessMistakes: number;
  alreadySolved: number;
}

export function simulateGame(setup: GameSetup): GameResult {
  const { sim, world, forcedHint } = setup;
  const { solution, unitsOfCell } = sim;
  const cellCount = solution.length;
  const values = new Array<number>(cellCount).fill(0);
  for (const { cell, value } of sim.puzzle.givens) values[cell] = value;
  const excluded: Exclusion[] = [];
  let empty = values.filter((value) => value === 0).length;
  const initialEmpty = empty;
  let hintsLeft = world.teamHints;
  const log: ScoringEvent[] = [];
  const guesses: number[] = [];
  const decidedLevels: number[] = [];
  let forced: GameResult["forced"] = null;
  let forcedDone = false;

  const bots: Bot[] = setup.bots.map((spec, seat) => ({
    seat,
    spec,
    rng: simRng(mixSeed(setup.seed, seat)),
    lives: seat === setup.absent ? 0 : world.lives,
    action: seat === setup.absent ? null : { kind: "decide", time: 0 },
    idle: false,
    guesses: 0,
    guessMistakes: 0,
    alreadySolved: 0,
  }));
  const active = (bot: Bot): boolean => bot.lives > 0;
  const think = (bot: Bot, level: number): number =>
    bot.spec.speed * (world.times[level - 1] ?? NaN) * bot.rng.lognormal(world.thinkSigma);

  const pickRandom = (bot: Bot, list: readonly number[]): number =>
    list[bot.rng.int(list.length)] ?? NaN;

  /** La víctima de un robo: el bot con la jugada correcta pendiente más difícil (nivel ≥ 2). */
  const victimOf = (seat: number): { victim: number; cell: number } | null => {
    let best: { victim: number; cell: number; level: number } | null = null;
    for (const other of bots) {
      const action = other.action;
      if (other.seat === seat || action?.kind !== "place" || action.level < 2) continue;
      if (action.digit !== solution[action.cell]) continue;
      if (!best || action.level > best.level)
        best = { victim: other.seat, cell: action.cell, level: action.level };
    }
    return best && { victim: best.victim, cell: best.cell };
  };

  /** La celda más difícil del tablero (la pista que más destraba); a igual nivel, la primera. */
  const hardestCell = (levels: readonly number[]): number => {
    let best = -1;
    for (let cell = 0; cell < cellCount; cell++) {
      if (values[cell] !== 0) continue;
      if (best < 0 || (levels[cell] ?? 0) > (levels[best] ?? 0)) best = cell;
    }
    return best;
  };

  const decide = (bot: Bot, now: number): void => {
    bot.idle = false;
    const { levels, fixpoints } = sim.analyze(values, excluded);
    const { skill, kind, hintProb } = bot.spec;
    const availableUpTo = (limit: number): { cells: number[]; minLevel: number } => {
      const cells: number[] = [];
      let minLevel = Infinity;
      for (let cell = 0; cell < cellCount; cell++) {
        const level = levels[cell] ?? 0;
        if (values[cell] !== 0 || level === 0 || level > limit) continue;
        cells.push(cell);
        minLevel = Math.min(minLevel, level);
      }
      return { cells, minLevel };
    };
    let { cells: available, minLevel } = availableUpTo(skill);
    // Sin adivinar, el adivinador trabado deduce la celda más fácil fuera de su alcance.
    const beyondSkill = available.length === 0 && setup.noGuess === true;
    if (beyondSkill) ({ cells: available, minLevel } = availableUpTo(MAX_TECHNIQUE_LEVEL));

    if (available.length > 0) {
      const pool =
        kind === "fast" || beyondSkill
          ? available.filter((cell) => levels[cell] === minLevel)
          : available;
      const cell = pickRandom(bot, pool);
      const level = levels[cell] ?? 1;
      const noise = bot.rng.lognormal(world.thinkSigma);
      const slip = bot.rng.float() < world.slip;
      const triggered =
        forcedHint !== undefined &&
        !forcedDone &&
        forcedHint.seat === bot.seat &&
        hintsLeft > 0 &&
        1 - empty / initialEmpty >= forcedHint.afterFilled;
      if (triggered) {
        forcedDone = true;
        const steal = forcedHint.steal ? victimOf(bot.seat) : null;
        const target = steal?.cell ?? hardestCell(levels);
        forced = { cell: target, victim: steal?.victim ?? null, at: now };
        const click = now + bot.spec.speed * world.times[0] * noise;
        if (forcedHint.mode === "hint") {
          bot.action = { kind: "hint", time: click, cell: target };
          return;
        }
        if (forcedHint.mode === "placebo") {
          bot.action = { kind: "decide", time: click };
          return;
        }
      } else if (hintsLeft > 0 && hintProb > 0 && minLevel >= 4 && bot.rng.float() < hintProb) {
        bot.action = { kind: "hint", time: now + bot.spec.speed * world.times[0] * noise, cell };
        return;
      }
      const digit = slip ? wrongDigit(bot, cell, fixpoints[0]?.[cell] ?? 0) : (solution[cell] ?? 0);
      const time = now + bot.spec.speed * (world.times[level - 1] ?? NaN) * noise;
      bot.action = { kind: "place", time, cell, digit, level };
      return;
    }

    // Nada a su alcance: solo le pasa al adivinador (lógico y veloz llegan al nivel 5, y en el banco
    // toda celda se deduce con nivel ≤ 5, T-20.5).
    const masks = fixpoints[Math.min(skill, MAX_TECHNIQUE_LEVEL)];
    let fewest = Infinity;
    let candidates: number[] = [];
    for (let cell = 0; cell < cellCount; cell++) {
      if (values[cell] !== 0) continue;
      const count = popcount(masks?.[cell] ?? 0);
      if (count < fewest) {
        fewest = count;
        candidates = [cell];
      } else if (count === fewest) candidates.push(cell);
    }
    if (candidates.length === 0) {
      bot.action = null;
      bot.idle = true;
      return;
    }
    const cell = pickRandom(bot, candidates);
    if (hintsLeft > 0 && hintProb > 0 && bot.rng.float() < hintProb) {
      bot.action = { kind: "hint", time: now + think(bot, 1), cell };
      return;
    }
    const digit = pickRandom(bot, digitsOf(masks?.[cell] ?? 0));
    bot.guesses++;
    bot.action = { kind: "place", time: now + think(bot, 1), cell, digit, level: 0 };
  };

  const wrongDigit = (bot: Bot, cell: number, mask: number): number => {
    const right = solution[cell] ?? 0;
    const options = digitsOf(mask & ~digitBit(right)).filter(
      (digit) => !excluded.some((e) => e.cell === cell && e.digit === digit),
    );
    if (options.length > 0) return pickRandom(bot, options);
    const any = Array.from({ length: sim.puzzle.size }, (_, i) => i + 1).filter((d) => d !== right);
    return pickRandom(bot, any);
  };

  /** Despierta a los que esperaban y avisa a quien pensaba la celda bloqueada (R-05). */
  const changed = (now: number, lockedCell: number | null): void => {
    for (const bot of bots) {
      if (!active(bot)) continue;
      if (bot.idle) {
        bot.idle = false;
        bot.action = { kind: "decide", time: now + world.reaction };
      } else if (
        lockedCell !== null &&
        bot.action?.kind !== "decide" &&
        bot.action?.cell === lockedCell &&
        bot.action.time > now + world.reaction
      ) {
        bot.action = { kind: "decide", time: now + world.reaction };
      }
    }
  };

  const lock = (cell: number, now: number): void => {
    values[cell] = solution[cell] ?? 0;
    empty--;
    changed(now, cell);
  };

  const closedUnitsOf = (cell: number): ClosedUnit[] =>
    (unitsOfCell[cell] ?? [])
      .filter(({ cells }) => cells.every((c) => c === cell || values[c] !== 0))
      .map(({ unit, index }) => ({ unit, index }));

  let now = 0;
  let outcome: Outcome | null = null;
  while (outcome === null) {
    let next: Bot | null = null;
    for (const bot of bots) {
      if (active(bot) && bot.action && (!next || bot.action.time < (next.action?.time ?? Infinity)))
        next = bot;
    }
    if (!next?.action) {
      outcome = "stalled";
      break;
    }
    const action = next.action;
    if (setup.horizon !== undefined && action.time > setup.horizon) {
      now = setup.horizon;
      outcome = "horizon";
      break;
    }
    now = action.time;
    next.action = null;
    const playerId = String(next.seat);

    if (action.kind === "decide") {
      decide(next, now);
      continue;
    }
    if (values[action.cell] !== 0) {
      // Ya resuelta (R-05): sin penalización ni evento.
      next.alreadySolved++;
      decide(next, now);
      continue;
    }
    if (action.kind === "hint") {
      if (hintsLeft === 0) {
        decide(next, now);
        continue;
      }
      hintsLeft--;
      decidedLevels.push(0);
      log.push({ type: "hint", playerId, cell: action.cell, at: now });
      lock(action.cell, now);
    } else if (action.digit === solution[action.cell]) {
      if (action.level === 0) guesses.push(log.length);
      const levelToDeduce = sim.analyze(values, excluded).levels[action.cell] ?? NaN;
      const closedUnits = closedUnitsOf(action.cell);
      decidedLevels.push(action.level);
      log.push({
        type: "correct",
        playerId,
        cell: action.cell,
        at: now,
        levelToDeduce,
        closedUnits,
      });
      lock(action.cell, now);
    } else {
      if (action.level === 0) {
        guesses.push(log.length);
        next.guessMistakes++;
      }
      decidedLevels.push(0);
      log.push({ type: "mistake", playerId, cell: action.cell, digit: action.digit, at: now });
      excluded.push({ cell: action.cell, digit: action.digit });
      excluded.sort((a, b) => a.cell - b.cell || a.digit - b.digit);
      next.lives--;
      changed(now, null);
    }

    if (empty === 0) outcome = "victory";
    else if (!bots.some(active)) outcome = "defeat";
    // Su acción ya se consumió (y `changed` no toca a quien no tiene una): decide la siguiente.
    else if (active(next)) decide(next, now);
  }

  return {
    log,
    guesses,
    decidedLevels,
    end: now,
    outcome,
    bots: bots.map(({ lives, guesses, guessMistakes, alreadySolved }) => ({
      livesLeft: lives,
      guesses,
      guessMistakes,
      alreadySolved,
    })),
    forced,
  };
}
