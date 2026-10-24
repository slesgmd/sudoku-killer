// Partidas y su registro de eventos (ADR 0003 y 0004), con Drizzle sobre PostgreSQL (PGlite en las
// pruebas). Solo se agregan eventos: nunca se modifican ni se borran (un trigger lo impide). Cada
// evento leído se valida con el esquema Zod del registro antes de reproducirlo.
import { and, asc, eq, isNull } from "drizzle-orm";
import { matchEventSchema, type MatchEvent } from "@sudoku-killer/game";
import type { Difficulty } from "@sudoku-killer/protocol";
import type { Database } from "../db/database.ts";
import { LOG_VERSION, matchEvents, matches } from "../db/schema.ts";

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
  /** Una partida en curso con sus eventos; `null` si no existe o ya terminó. */
  loadRunning(matchId: string): Promise<StoredMatch | null>;
  /** Los eventos de una partida, en orden de `seq`. */
  events(matchId: string): Promise<MatchEvent[]>;
}

type MatchRow = typeof matches.$inferSelect;

function recordOf(row: MatchRow): MatchRecord {
  return {
    id: row.id,
    roomCode: row.roomCode,
    puzzleId: row.puzzleId,
    difficulty: row.difficulty,
    modeId: row.modeId,
    scoringParamsVersion: row.scoringParamsVersion,
    protocolVersion: row.protocolVersion,
    startedAt: row.startedAt.getTime(),
  };
}

export function createMatchRepository(db: Database): MatchRepository {
  const events = async (matchId: string): Promise<MatchEvent[]> => {
    const rows = await db
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.matchId, matchId))
      .orderBy(asc(matchEvents.seq));
    return rows.map((row) =>
      matchEventSchema.parse({
        seq: row.seq,
        ts: row.serverTs.getTime(),
        type: row.type,
        payload: row.payload,
      }),
    );
  };

  const stored = async (row: MatchRow): Promise<StoredMatch> => ({
    match: recordOf(row),
    events: await events(row.id),
  });

  return {
    events,
    async commit(batch) {
      await db.transaction(async (tx) => {
        if (batch.matches.length > 0) {
          await tx.insert(matches).values(
            batch.matches.map((match) => ({
              ...match,
              logVersion: LOG_VERSION,
              startedAt: new Date(match.startedAt),
            })),
          );
        }
        if (batch.events.length > 0) {
          await tx.insert(matchEvents).values(
            batch.events.map(({ matchId, event }) => ({
              matchId,
              seq: event.seq,
              type: event.type,
              payload: event.payload,
              serverTs: new Date(event.ts),
            })),
          );
        }
        for (const { matchId, event } of batch.events) {
          if (event.type !== "match.ended") continue;
          await tx
            .update(matches)
            .set({ endedAt: new Date(event.ts), result: event.payload.result })
            .where(eq(matches.id, matchId));
        }
      });
    },
    async listRunning() {
      const rows = await db
        .select()
        .from(matches)
        .where(isNull(matches.endedAt))
        .orderBy(asc(matches.startedAt));
      return Promise.all(rows.map(stored));
    },
    async loadRunning(matchId) {
      const [row] = await db
        .select()
        .from(matches)
        .where(and(eq(matches.id, matchId), isNull(matches.endedAt)));
      return row ? stored(row) : null;
    },
  };
}
