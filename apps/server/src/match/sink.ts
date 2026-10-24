// Destino de los eventos (ADR 0004): la sala entrega sus eventos y espera la confirmación antes de
// difundirlos. Esta versión confirma cada entrega por separado; el group commit la reemplaza.
import type { MatchEvent } from "@sudoku-killer/game";
import type { MatchRecord, MatchRepository } from "./repository.ts";

export interface EventSink {
  /** Se resuelve cuando los eventos quedan confirmados en la base de datos. */
  write(entry: {
    readonly match?: MatchRecord;
    readonly matchId: string;
    readonly events: readonly MatchEvent[];
  }): Promise<void>;
}

export function directSink(repository: MatchRepository): EventSink {
  return {
    write: ({ match, matchId, events }) =>
      repository.commit({
        matches: match ? [match] : [],
        events: events.map((event) => ({ matchId, event })),
      }),
  };
}
