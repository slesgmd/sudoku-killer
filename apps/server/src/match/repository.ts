// Partidas y su registro de eventos (ADR 0003 y 0004). Solo se agregan eventos: nunca se modifican
// ni se borran. La implementación con Drizzle llega con la persistencia; el doble en memoria sirve
// a las pruebas, también para provocar fallos de la base de datos (E-16).
import type { Difficulty } from "@sudoku-killer/protocol";
import type { MatchEvent } from "@sudoku-killer/game";

/** Una fila de `matches`, sin el resultado. */
export interface MatchRecord {
  readonly id: string;
  readonly roomCode: string;
  readonly puzzleId: string;
  readonly difficulty: Difficulty;
  readonly modeId: string;
  readonly scoringParamsVersion: string;
  readonly protocolVersion: number;
  readonly startedAt: number;
}

/** Lo que se confirma en una transacción: partidas nuevas y eventos, en orden. */
export interface CommitBatch {
  readonly matches: readonly MatchRecord[];
  readonly events: readonly { readonly matchId: string; readonly event: MatchEvent }[];
}

export interface StoredMatch {
  readonly match: MatchRecord;
  readonly events: readonly MatchEvent[];
}

export interface MatchRepository {
  /** Confirma el lote en una sola transacción. `match.ended` cierra su partida. */
  commit(batch: CommitBatch): Promise<void>;
  /** Partidas sin `ended_at`, con sus eventos en orden de `seq`. */
  listRunning(): Promise<StoredMatch[]>;
  /** Los eventos de una partida, en orden de `seq`. */
  events(matchId: string): Promise<MatchEvent[]>;
}

/** Doble en memoria. `failing` hace fallar las confirmaciones (E-16). */
export class MemoryMatchRepository implements MatchRepository {
  failing = false;
  private readonly matches = new Map<string, { match: MatchRecord; ended: boolean }>();
  private readonly log = new Map<string, MatchEvent[]>();

  commit(batch: CommitBatch): Promise<void> {
    if (this.failing) return Promise.reject(new Error("database unavailable"));
    for (const match of batch.matches) {
      if (this.matches.has(match.id))
        return Promise.reject(new Error(`duplicate match ${match.id}`));
    }
    for (const match of batch.matches) {
      this.matches.set(match.id, { match, ended: false });
      this.log.set(match.id, []);
    }
    for (const { matchId, event } of batch.events) {
      const events = this.log.get(matchId);
      if (!events) return Promise.reject(new Error(`unknown match ${matchId}`));
      if (event.seq !== events.length + 1) {
        return Promise.reject(new Error(`seq ${String(event.seq)} out of order in ${matchId}`));
      }
      events.push(structuredClone(event));
      if (event.type === "match.ended") {
        const entry = this.matches.get(matchId);
        if (entry) entry.ended = true;
      }
    }
    return Promise.resolve();
  }

  listRunning(): Promise<StoredMatch[]> {
    return Promise.resolve(
      [...this.matches.values()]
        .filter((entry) => !entry.ended)
        .map(({ match }) => ({ match, events: structuredClone(this.log.get(match.id) ?? []) })),
    );
  }

  events(matchId: string): Promise<MatchEvent[]> {
    return Promise.resolve(structuredClone(this.log.get(matchId) ?? []));
  }
}
