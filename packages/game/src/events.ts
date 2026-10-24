// Eventos del registro de una partida (ADR 0004): solo hechos, con `seq` y la hora del servidor.
// Los puntos, las limpiezas, los cambios de rol y el ranking se recalculan al reproducir.
import type {
  Connection,
  Difficulty,
  NoteLayer,
  NoteOp,
  MatchResult,
} from "@sudoku-killer/protocol";
import type { PlayerId } from "./types.ts";

/** Un jugador al empezar la partida o al entrar a mitad de partida. */
export interface PlayerEntry {
  readonly playerId: PlayerId;
  readonly nickname: string;
  readonly seat: number | null;
  readonly joinedAt: number;
  readonly tokenHash: string;
  readonly connection: Connection;
  readonly autoCleanPersonalNotes: boolean;
}

interface EventOf<T extends string, P> {
  readonly seq: number;
  /** Hora del servidor, en milisegundos. */
  readonly ts: number;
  readonly type: T;
  readonly payload: P;
}

export type MatchStartedEvent = EventOf<
  "match.started",
  {
    readonly matchId: string;
    readonly puzzleId: string;
    readonly difficulty: Difficulty;
    readonly modeId: string;
    readonly scoringParamsVersion: string;
    readonly hintsTotal: number;
    readonly starterId: PlayerId | null;
    readonly players: readonly PlayerEntry[];
  }
>;

export type MatchEvent =
  | MatchStartedEvent
  | EventOf<"player.joined", PlayerEntry>
  | EventOf<
      "player.connection",
      { readonly playerId: PlayerId; readonly connection: Connection; readonly seat: number | null }
    >
  | EventOf<"starter.changed", { readonly playerId: PlayerId | null }>
  | EventOf<
      "settings.changed",
      {
        readonly playerId: PlayerId;
        readonly autoCleanPersonalNotes: boolean;
        readonly clientMsgId: string;
      }
    >
  | EventOf<
      "cell.solved",
      {
        readonly playerId: PlayerId;
        readonly cell: number;
        readonly value: number;
        /** `levelToDeduce` antes de la jugada, con los descartes públicos (F6). */
        readonly level: number;
        /** Versión del calificador que dio `level`. */
        readonly graderVersion: string;
        readonly clientMsgId: string;
      }
    >
  | EventOf<
      "cell.mistake",
      {
        readonly playerId: PlayerId;
        readonly cell: number;
        readonly digit: number;
        readonly clientMsgId: string;
      }
    >
  | EventOf<
      "hint.used",
      {
        readonly playerId: PlayerId;
        readonly cell: number;
        readonly value: number;
        readonly clientMsgId: string;
      }
    >
  | EventOf<
      "note.op",
      {
        readonly layer: NoteLayer;
        readonly ownerId: PlayerId | null;
        readonly playerId: PlayerId;
        readonly cell: number;
        readonly digit: number;
        readonly op: NoteOp;
        readonly clientMsgId: string;
        readonly undoOf?: number;
      }
    >
  | EventOf<"match.ended", { readonly result: MatchResult }>;

export type MatchEventType = MatchEvent["type"];
export type EventOfType<T extends MatchEventType> = Extract<MatchEvent, { type: T }>;
