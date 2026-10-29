// Modelo de comparación basado en velocidad : una base por dificultad que decrece con el
// tiempo desde la jugada anterior del mismo jugador, con un mínimo y un multiplicador por completar
// filas, columnas o cajas. Sirve para mostrar cuánto reduce el modelo propio la ventaja de correr por
// las celdas fáciles. Puntúa los mismos registros que el modelo propio.
import type { Difficulty } from "@sudoku-killer/protocol";
import type { ScoringEvent } from "@sudoku-killer/scoring";

export interface SpeedBaseline {
  readonly base: Readonly<Record<Difficulty, number>>;
  /** Segundos en que la base cae a 1/e. */
  readonly tau: number;
  readonly min: number;
  /** Cada fila, columna o caja completada suma este múltiplo de los puntos de la celda. */
  readonly areaMultiplier: number;
  readonly mistake: number;
  readonly hint: number;
}

export const SPEED_BASELINE: SpeedBaseline = {
  base: { easy: 60, medium: 80, hard: 100, expert: 120 },
  tau: 30,
  min: 5,
  areaMultiplier: 0.5,
  mistake: 30,
  hint: 0,
};

/** Puntaje de cada asiento con el modelo de velocidad. */
export function baselineScores(
  log: readonly ScoringEvent[],
  difficulty: Difficulty,
  seats: number,
  model: SpeedBaseline = SPEED_BASELINE,
): { readonly scores: number[]; readonly gained: number } {
  const scores = new Array<number>(seats).fill(0);
  const last = new Array<number>(seats).fill(0);
  let gained = 0;
  for (const event of log) {
    const seat = Number(event.playerId);
    if (event.type === "correct") {
      const elapsed = event.at - (last[seat] ?? 0);
      const cell = Math.max(
        model.min,
        Math.round(model.base[difficulty] * Math.exp(-elapsed / model.tau)),
      );
      const areas = event.closedUnits.filter(({ unit }) => unit !== "cage").length;
      const points = Math.round(cell * (1 + model.areaMultiplier * areas));
      scores[seat] = (scores[seat] ?? 0) + points;
      gained += points;
    } else if (event.type === "mistake") {
      scores[seat] = (scores[seat] ?? 0) - model.mistake;
    } else {
      scores[seat] = (scores[seat] ?? 0) - model.hint;
    }
    if (event.type !== "hint") last[seat] = event.at;
  }
  return { scores, gained };
}
