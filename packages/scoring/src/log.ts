// Puntaje de una partida a partir de sus hechos (R-32): puntaje = f(registro, parámetros). El
// mismo registro se puede recalcular con otra versión de los parámetros (T-32.4).
import type { ScoringParams } from "./params.ts";
import {
  createScoring,
  type CorrectContext,
  type HintContext,
  type MistakeContext,
  type ScoreChange,
} from "./score.ts";

/** Un hecho que puntúa, con el contexto que tenía al ocurrir. */
export type ScoringEvent<P extends string = string> =
  | ({ readonly type: "correct" } & CorrectContext<P>)
  | ({ readonly type: "mistake" } & MistakeContext<P>)
  | ({ readonly type: "hint" } & HintContext<P>);

export interface PlayerTally {
  readonly score: number;
  readonly mistakes: number;
  /**
   * El `at` más alto de los hechos que cambiaron su puntaje, o `null` si nunca cambió. En un registro
   * en orden es el último cambio (SPEC §2.3); tomar el máximo lo hace independiente del orden de los
   * hechos que no se afectan (T-36.4).
   */
  readonly scoreReachedAt: number | null;
}

/** Los cambios de puntaje de un hecho. */
export function changesOf<P extends string>(
  event: ScoringEvent<P>,
  params: ScoringParams,
): { readonly score: readonly ScoreChange<P>[]; readonly mistake: boolean } {
  const scoring = createScoring(params);
  switch (event.type) {
    case "correct":
      return { score: scoring.onCorrect(event), mistake: false };
    case "mistake":
      return { score: scoring.onMistake(event).score, mistake: true };
    case "hint":
      return { score: scoring.onHint(event), mistake: false };
  }
}

/**
 * Puntaje, errores y `scoreReachedAt` de cada jugador. `players` agrega a los que no tienen hechos
 * (con 0 puntos). Determinista: no lee el reloj ni modifica el registro.
 */
export function scoreLog<P extends string>(
  events: Iterable<ScoringEvent<P>>,
  params: ScoringParams,
  players: Iterable<P> = [],
): ReadonlyMap<P, PlayerTally> {
  const tallies = new Map<P, { score: number; mistakes: number; scoreReachedAt: number | null }>();
  const tallyOf = (playerId: P) => {
    let tally = tallies.get(playerId);
    if (!tally) {
      tally = { score: 0, mistakes: 0, scoreReachedAt: null };
      tallies.set(playerId, tally);
    }
    return tally;
  };
  for (const playerId of players) tallyOf(playerId);
  for (const event of events) {
    const { score, mistake } = changesOf(event, params);
    if (mistake) tallyOf(event.playerId).mistakes++;
    for (const { playerId, delta } of score) {
      const tally = tallyOf(playerId);
      if (delta === 0) continue;
      tally.score += delta;
      tally.scoreReachedAt = Math.max(tally.scoreReachedAt ?? event.at, event.at);
    }
  }
  return tallies;
}
