// Inicio de una partida (SPEC §3.1): el evento `match.started`, primero del registro.
import type { Difficulty, PublicPuzzle } from "@sudoku-killer/protocol";
import type { MatchStartedEvent, PlayerEntry } from "./events.ts";
import type { GameMode } from "./mode.ts";
import type { PlayerId } from "./types.ts";

export interface StartOptions {
  readonly matchId: string;
  readonly puzzle: PublicPuzzle;
  readonly difficulty: Difficulty;
  readonly starterId: PlayerId | null;
  /** Todo jugador con asiento pasa a activo, con las vidas iniciales y 0 puntos. */
  readonly players: readonly PlayerEntry[];
  readonly mode: GameMode;
  readonly at: number;
}

export function startMatch({
  matchId,
  puzzle,
  difficulty,
  starterId,
  players,
  mode,
  at,
}: StartOptions): MatchStartedEvent {
  return {
    seq: 1,
    ts: at,
    type: "match.started",
    payload: {
      matchId,
      puzzleId: puzzle.id,
      difficulty,
      modeId: mode.id,
      scoringParamsVersion: mode.scoringParamsVersion,
      hintsTotal: mode.rules.teamHints,
      starterId,
      players: [...players],
    },
  };
}
