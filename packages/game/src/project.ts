// Mensajes del servidor que produce cada evento (SPEC §4.3) y el snapshot de un jugador (§4.5).
// Las notas personales solo van a su dueño (R-29) y `value` solo lleva dígitos revelados por el
// servidor (convención anti-filtración de §4.3).
import { digitsOf } from "@sudoku-killer/engine";
import type {
  Bonus,
  DefeatCause,
  Difficulty,
  PublicPlayer,
  RoomState,
  ServerEnvelope,
  ServerMessage,
  ServerMessageType,
  Snapshot,
} from "@sudoku-killer/protocol";
import type { Effects } from "./apply.ts";
import type { MatchEvent } from "./events.ts";
import type { GameMode } from "./mode.ts";
import type { MatchPlayer, MatchState, PlayerId } from "./types.ts";

/** A quién va un mensaje. */
export type Audience =
  | { readonly kind: "all" }
  | { readonly kind: "only"; readonly playerId: PlayerId }
  | { readonly kind: "except"; readonly playerId: PlayerId };

/** Un mensaje del servidor sin sobre: `fanOut` le pone `v`, `seq` y `replyTo`. */
export type Outgoing = {
  [T in ServerMessageType]: {
    readonly audience: Audience;
    readonly type: T;
    readonly payload: ServerMessage<T>["payload"];
    readonly seq?: number;
  };
}[ServerMessageType];

export function publicPlayer(player: MatchPlayer): PublicPlayer {
  return {
    id: player.id,
    nickname: player.nickname,
    seat: player.seat,
    joinedAt: player.joinedAt,
    connection: player.connection,
    role: player.role,
    lives: player.lives,
    score: player.score,
    mistakes: player.mistakes,
  };
}

export function publicPlayers(state: MatchState): PublicPlayer[] {
  return [...state.players.values()].map(publicPlayer);
}

const all: Audience = { kind: "all" };

/**
 * Causa de la derrota (SPEC §4.3) según el estado final: los jugadores del ranking son todos los de
 * la partida, también los que salieron o expiraron, que la sala purga al terminar. Es pura, así que
 * `replay` del registro da la misma causa. `undefined` si la partida no terminó en derrota.
 */
export function defeatCause(state: MatchState): DefeatCause | undefined {
  if (state.result !== "defeat") return undefined;
  const players = [...state.players.values()];
  const outOfLives = players.filter((player) => player.lives === 0).length;
  if (outOfLives === 0) return "gone";
  return outOfLives === players.length ? "lives" : "mixed";
}

/** `{ defeatCause }` para esparcir en un payload, o nada si no es una derrota. */
function withDefeatCause(state: MatchState): { defeatCause?: DefeatCause } {
  const cause = defeatCause(state);
  return cause === undefined ? {} : { defeatCause: cause };
}

function pointsOf(effects: Effects, playerId: PlayerId): number {
  return effects.changes.reduce((sum, c) => (c.playerId === playerId ? sum + c.delta : sum), 0);
}

function scoreOf(state: MatchState, playerId: PlayerId): number {
  return state.players.get(playerId)?.score ?? 0;
}

/**
 * Mensajes de un evento ya aplicado: `after` es el estado con el evento y `effects`, lo que
 * devolvió `applyWithEffects`. `match.started` y la bienvenida los arma la sala.
 */
export function messagesOf(
  event: MatchEvent,
  after: MatchState,
  effects: Effects,
  mode: GameMode,
): Outgoing[] {
  const seq = event.seq;
  switch (event.type) {
    case "match.started":
      return [];
    case "player.joined": {
      const player = after.players.get(event.payload.playerId);
      if (!player) return [];
      return [
        {
          audience: { kind: "except", playerId: player.id },
          type: "room.player_joined",
          payload: { player: publicPlayer(player) },
          seq,
        },
      ];
    }
    case "player.connection":
      return [{ audience: all, type: "room.player_connection", payload: event.payload, seq }];
    case "starter.changed":
      return [{ audience: all, type: "room.starter_changed", payload: event.payload, seq }];
    case "settings.changed":
      return [
        {
          audience: { kind: "only", playerId: event.payload.playerId },
          type: "ack",
          payload: { applied: true },
          seq,
        },
      ];
    case "cell.solved": {
      const { playerId, cell, value } = event.payload;
      const closures = effects.changes.filter((c) => c.reason === "closure");
      const bonuses: Bonus[] = effects.closedUnits.map((unit, i) => ({
        unit: unit.unit,
        index: unit.index,
        points: closures[i]?.delta ?? 0,
      }));
      return [
        {
          audience: all,
          type: "cell.solved",
          payload: {
            cell,
            value,
            by: playerId,
            points: pointsOf(effects, playerId),
            score: scoreOf(after, playerId),
            bonuses,
          },
          seq,
        },
      ];
    }
    case "cell.mistake": {
      const { playerId, cell, digit } = event.payload;
      const player = after.players.get(playerId);
      return [
        {
          audience: all,
          type: "cell.mistake",
          payload: {
            cell,
            digit,
            by: playerId,
            points: pointsOf(effects, playerId),
            score: scoreOf(after, playerId),
            livesLeft: player?.lives ?? 0,
            role: player?.role ?? "spectator",
          },
          seq,
        },
      ];
    }
    case "hint.used": {
      const { playerId, cell, value } = event.payload;
      return [
        {
          audience: all,
          type: "hint.used",
          payload: {
            cell,
            value,
            by: playerId,
            points: pointsOf(effects, playerId),
            score: scoreOf(after, playerId),
            hintsLeft: after.hintsLeft,
          },
          seq,
        },
      ];
    }
    case "note.op": {
      const { layer, ownerId, playerId, cell, digit, op, undoOf } = event.payload;
      const audience: Audience =
        layer === "group" ? all : { kind: "only", playerId: ownerId ?? playerId };
      return [
        {
          audience,
          type: "note.applied",
          payload: {
            opSeq: seq,
            layer,
            op,
            cell,
            digit,
            by: playerId,
            ...(undoOf === undefined ? {} : { undoOf }),
          },
          seq,
        },
      ];
    }
    case "match.ended":
      return [
        {
          audience: all,
          type: "match.ended",
          payload: {
            result: event.payload.result,
            ...withDefeatCause(after),
            endedAt: event.ts,
            ranking: mode.ranking(after),
          },
          seq,
        },
      ];
  }
}

/** Notas de una capa como `{ cell, mask }`, solo las celdas con candidatos. */
function notesList(notes: Uint16Array): { cell: number; mask: number }[] {
  const list: { cell: number; mask: number }[] = [];
  notes.forEach((mask, cell) => {
    if (digitsOf(mask).length > 0) list.push({ cell, mask });
  });
  return list;
}

export interface RoomView {
  readonly code: string;
  readonly state: RoomState;
  readonly starterId: PlayerId | null;
  readonly difficulty: Difficulty;
  readonly players: readonly PublicPlayer[];
}

/** Snapshot de la partida para `playerId` (SPEC §4.5). La parte de la sala la da el servidor. */
export function snapshotFor(
  state: MatchState,
  room: RoomView,
  playerId: PlayerId,
  serverNow: number,
  mode: GameMode,
): Snapshot {
  const you = state.players.get(playerId);
  const locked = state.cells.flatMap((cell, index) =>
    cell.status === "locked"
      ? [{ cell: index, value: cell.value, source: cell.source, by: cell.by }]
      : [],
  );
  return {
    serverNow,
    atSeq: state.seq,
    room: { ...room, players: [...room.players] },
    match: {
      id: state.id,
      puzzle: state.puzzle,
      startedAt: state.startedAt,
      endedAt: state.endedAt,
      result: state.result,
      ...withDefeatCause(state),
      hintsLeft: state.hintsLeft,
      locked,
      groupNotes: notesList(state.groupNotes),
      ranking: state.endedAt === null ? null : mode.ranking(state),
    },
    you: {
      playerId,
      settings: you?.settings ?? { autoCleanPersonalNotes: true },
      personalNotes: you ? notesList(you.personalNotes) : [],
    },
  };
}

/**
 * Sobres de cada destinatario. La copia del autor de un comando lleva `replyTo` (SPEC §4.1), y la
 * reciben solo los `recipients` (los jugadores conectados, que decide la sala).
 */
export function fanOut(
  messages: readonly Outgoing[],
  recipients: readonly PlayerId[],
  author?: { readonly playerId: PlayerId; readonly clientMsgId: string },
): { readonly to: PlayerId; readonly envelope: ServerEnvelope }[] {
  const deliveries: { to: PlayerId; envelope: ServerEnvelope }[] = [];
  for (const { audience, type, payload, seq } of messages) {
    for (const to of recipients) {
      const included =
        audience.kind === "all" ||
        (audience.kind === "only" ? audience.playerId === to : audience.playerId !== to);
      if (!included) continue;
      const envelope = {
        v: 1,
        type,
        payload,
        ...(seq === undefined ? {} : { seq }),
        ...(author?.playerId === to ? { replyTo: author.clientMsgId } : {}),
      } as ServerEnvelope;
      deliveries.push({ to, envelope });
    }
  }
  return deliveries;
}
