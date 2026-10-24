// Modo Normal (SPEC §5): cooperativo, con vidas por jugador, pistas de equipo y ranking de aporte.
// La puntuación sale de `createScoring` sin adaptarla (T-36.5).
import { createScoring, rankPlayers, type ScoringParams } from "@sudoku-killer/scoring";
import type { GameMode } from "../mode.ts";
import { NORMAL_RULES, normalCan } from "../permissions.ts";
import type { MatchState } from "../types.ts";

export const NORMAL_MODE_ID = "normal";

/** Cuenta para D4: activo y conectado o dentro del plazo de gracia. */
function isLiveActive(player: { role: string; connection: string }): boolean {
  return (
    player.role === "active" &&
    (player.connection === "connected" || player.connection === "disconnected")
  );
}

export function createNormalMode(params: ScoringParams): GameMode {
  const scoring = createScoring(params);
  return {
    id: NORMAL_MODE_ID,
    rules: NORMAL_RULES,
    scoringParamsVersion: params.version,
    can: normalCan,
    onCorrect: (ctx) => scoring.onCorrect(ctx),
    onMistake: (ctx) => scoring.onMistake(ctx),
    onHint: (ctx) => scoring.onHint(ctx),
    roleAfterLives: (lives) => (lives > 0 ? "active" : "spectator"),
    outcome(state: Readonly<MatchState>) {
      if (state.cells.every((cell) => cell.status === "locked")) return "victory";
      return [...state.players.values()].some(isLiveActive) ? null : "defeat";
    },
    ranking(state: Readonly<MatchState>) {
      return rankPlayers(
        [...state.players.values()].map((player) => ({
          playerId: player.id,
          nickname: player.nickname,
          score: player.score,
          mistakes: player.mistakes,
          scoreReachedAt: player.scoreReachedAt,
        })),
      );
    },
  };
}
