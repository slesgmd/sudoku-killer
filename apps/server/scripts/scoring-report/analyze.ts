// Análisis de partidas jugadas para la recalibración de la puntuación (`docs/puntuacion.md`,
// sección 11). Puro: recibe los registros de eventos de partidas terminadas y sus puzzles públicos,
// los reproduce con el reductor de `packages/game` y calcula lo que la sección 11 pide medir. No
// cambia ningún parámetro: una versión nueva de los parámetros sería un archivo nuevo.
//
// Limitaciones del registro (ver la salida `limits`): la presencia no se guarda, así que T(L) se
// estima con el tiempo entre jugadas de un mismo jugador (`docs/IDEAS_FUTURAS.md`, sección 8) y el
// «robo» de una pista sobre la celda que otro tenía seleccionada no se puede medir.
import {
  applyWithEffects,
  createNormalMode,
  initialState,
  type MatchEvent,
  type MatchState,
} from "@sudoku-killer/game";
import type { Difficulty, PublicPuzzle } from "@sudoku-killer/protocol";
import { PARAMS_V1, rankPlayers, type ScoringParams } from "@sudoku-killer/scoring";

export interface AnalyzedMatch {
  readonly difficulty: Difficulty;
  readonly puzzle: PublicPuzzle;
  readonly events: readonly MatchEvent[];
}

/** Ventana para «probar hasta acertar»: el mismo jugador acierta la celda donde acaba de fallar. */
export const RETRY_WINDOW_MS = 30_000;

interface Summary {
  readonly n: number;
  readonly median: number | null;
  readonly p95: number | null;
}

function summary(values: readonly number[]): Summary {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted.length === 0
      ? null
      : (sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? null);
  return { n: sorted.length, median: at(0.5), p95: at(0.95) };
}

const share = (part: number, total: number) =>
  total === 0 ? null : Number((part / total).toFixed(3));

/** Las celdas de la fila, la columna y la caja de una celda (sin ella). */
function peersOf(cell: number, puzzle: PublicPuzzle): number[] {
  const { size, boxRows, boxCols } = puzzle;
  const row = Math.floor(cell / size);
  const col = cell % size;
  const peers: number[] = [];
  for (let i = 0; i < size * size; i++) {
    if (i === cell) continue;
    const r = Math.floor(i / size);
    const c = i % size;
    const sameBox =
      Math.floor(r / boxRows) === Math.floor(row / boxRows) &&
      Math.floor(c / boxCols) === Math.floor(col / boxCols);
    if (r === row || c === col || sameBox) peers.push(i);
  }
  return peers;
}

/** Si el dígito ya está bloqueado en la fila, la columna o la caja (error evidente, D6). */
function evident(state: MatchState, cell: number, digit: number, puzzle: PublicPuzzle): boolean {
  return peersOf(cell, puzzle).some((peer) => {
    const locked = state.cells[peer];
    return locked?.status === "locked" && locked.value === digit;
  });
}

interface Acc {
  matches: number;
  victories: number;
  playerScores: number[];
  teamScores: number[];
  solved: number;
  mistakes: number;
  hints: number;
  mistakeGapsMs: number[];
  repeatedSameCell: number;
  evidentMistakes: number;
  mistakeLevels: Map<number, number>;
  retries: number;
  positivePoints: number;
  closurePoints: number;
  tieBreaks: number;
  exactTies: number;
  gapsByLevel: Map<number, number[]>;
  hintsPerPlayer: number[];
}

const empty = (): Acc => ({
  matches: 0,
  victories: 0,
  playerScores: [],
  teamScores: [],
  solved: 0,
  mistakes: 0,
  hints: 0,
  mistakeGapsMs: [],
  repeatedSameCell: 0,
  evidentMistakes: 0,
  mistakeLevels: new Map(),
  retries: 0,
  positivePoints: 0,
  closurePoints: 0,
  tieBreaks: 0,
  exactTies: 0,
  gapsByLevel: new Map(),
  hintsPerPlayer: [],
});

function analyzeOne(match: AnalyzedMatch, acc: Acc, params: ScoringParams): void {
  const [first, ...rest] = match.events;
  if (first?.type !== "match.started") return;
  const mode = createNormalMode(params);
  const context = { mode, puzzle: match.puzzle };
  let state = initialState(first, context);
  /** Última jugada (acierto, error, pista o nota) de cada jugador, para los intervalos. */
  const lastAction = new Map<string, number>();
  const mistakenCells = new Map<string, Set<number>>();
  const pendingRetry: { playerId: string; cell: number; at: number }[] = [];
  const mistakesByCell: number[] = [];
  const hints = new Map<string, number>();

  for (const event of rest) {
    const at = event.ts;
    const before = state;
    const applied = applyWithEffects(state, event, context);
    state = applied.state;
    for (const change of applied.effects.changes) {
      if (change.delta > 0) acc.positivePoints += change.delta;
      if (change.reason === "closure" && change.delta > 0) acc.closurePoints += change.delta;
    }
    switch (event.type) {
      case "cell.solved": {
        const { playerId, cell, level } = event.payload;
        acc.solved++;
        const previous = lastAction.get(playerId);
        if (previous !== undefined) {
          const gaps = acc.gapsByLevel.get(level) ?? [];
          gaps.push(at - previous);
          acc.gapsByLevel.set(level, gaps);
        }
        lastAction.set(playerId, at);
        const retry = pendingRetry.findIndex(
          (r) => r.playerId === playerId && r.cell === cell && at - r.at <= RETRY_WINDOW_MS,
        );
        if (retry >= 0) acc.retries++;
        if ((mistakesByCell[cell] ?? 0) > 0)
          acc.mistakeLevels.set(
            level,
            (acc.mistakeLevels.get(level) ?? 0) + (mistakesByCell[cell] ?? 0),
          );
        break;
      }
      case "cell.mistake": {
        const { playerId, cell, digit } = event.payload;
        acc.mistakes++;
        const previous = lastAction.get(playerId);
        if (previous !== undefined) acc.mistakeGapsMs.push(at - previous);
        lastAction.set(playerId, at);
        const cells = mistakenCells.get(playerId) ?? new Set<number>();
        if (cells.has(cell)) acc.repeatedSameCell++;
        cells.add(cell);
        mistakenCells.set(playerId, cells);
        if (evident(before, cell, digit, match.puzzle)) acc.evidentMistakes++;
        pendingRetry.push({ playerId, cell, at });
        mistakesByCell[cell] = (mistakesByCell[cell] ?? 0) + 1;
        break;
      }
      case "hint.used":
        acc.hints++;
        hints.set(event.payload.playerId, (hints.get(event.payload.playerId) ?? 0) + 1);
        lastAction.set(event.payload.playerId, at);
        break;
      case "note.op":
        lastAction.set(event.payload.playerId, at);
        break;
      default:
        break;
    }
  }

  acc.matches++;
  if (state.result === "victory") acc.victories++;
  const players = [...state.players.values()];
  for (const p of players) acc.playerScores.push(p.score);
  for (const p of players) acc.hintsPerPlayer.push(hints.get(p.id) ?? 0);
  acc.teamScores.push(players.reduce((sum, p) => sum + p.score, 0));
  const ranked = rankPlayers(
    players.map((p) => ({
      playerId: p.id,
      nickname: p.nickname,
      score: p.score,
      mistakes: p.mistakes,
      scoreReachedAt: p.scoreReachedAt,
    })),
  );
  for (let i = 1; i < ranked.length; i++) {
    const a = ranked[i - 1];
    const b = ranked[i];
    if (!a || b?.score !== a.score) continue;
    if (a.position === b.position) acc.exactTies++;
    else acc.tieBreaks++;
  }
}

/** Lo que `docs/puntuacion.md` §11 pide medir, por dificultad. */
export function analyze(matches: readonly AnalyzedMatch[], params: ScoringParams = PARAMS_V1) {
  const byDifficulty = new Map<Difficulty, Acc>();
  for (const match of matches) {
    const acc = byDifficulty.get(match.difficulty) ?? empty();
    analyzeOne(match, acc, params);
    byDifficulty.set(match.difficulty, acc);
  }
  const difficulties = Object.fromEntries(
    [...byDifficulty].map(([difficulty, acc]) => {
      const playerScore = summary(acc.playerScores);
      return [
        difficulty,
        {
          matches: acc.matches,
          victories: acc.victories,
          playerScore,
          teamScore: summary(acc.teamScores),
          // P frente al puntaje típico de un jugador: la primera prioridad de la §11.
          penaltyOverMedianPlayerScore:
            playerScore.median && playerScore.median > 0
              ? Number((params.mistakePenalty / playerScore.median).toFixed(3))
              : null,
          placements: { solved: acc.solved, mistakes: acc.mistakes },
          mistakeRate: share(acc.mistakes, acc.solved + acc.mistakes),
          mistakeSignals: {
            gapSincePreviousActionMs: summary(acc.mistakeGapsMs),
            repeatedSameCell: acc.repeatedSameCell,
            evident: acc.evidentMistakes,
            byLevelOfTheCell: Object.fromEntries([...acc.mistakeLevels].sort()),
          },
          tryUntilCorrect: { count: acc.retries, share: share(acc.retries, acc.mistakes) },
          hints: { total: acc.hints, perPlayer: summary(acc.hintsPerPlayer) },
          closureShareOfPoints: share(acc.closurePoints, acc.positivePoints),
          ranking: { decidedByTieBreak: acc.tieBreaks, exactTies: acc.exactTies },
          // Estimación de T(L): tiempo entre jugadas del mismo jugador, por nivel de la celda.
          gapBeforeSolveByLevelMs: Object.fromEntries(
            [...acc.gapsByLevel]
              .sort(([a], [b]) => a - b)
              .map(([level, gaps]) => [level, summary(gaps)]),
          ),
        },
      ];
    }),
  );
  return {
    paramsVersion: params.version,
    retryWindowMs: RETRY_WINDOW_MS,
    matches: matches.length,
    difficulties,
    limits: [
      "T(L) es una cota superior: el intervalo incluye el tiempo dedicado a otras celdas y a las notas (la presencia no se guarda).",
      "El robo de una pista sobre la celda que otro tenía seleccionada no se puede medir: la presencia no se guarda.",
      "El nivel de un error es el del acierto posterior en esa celda; los errores en celdas que nadie resolvió no tienen nivel.",
    ],
  };
}
