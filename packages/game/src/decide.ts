// Decisión de los comandos de juego (SPEC §4.2, §4.4 y §6): valida un comando contra el estado y
// devuelve los eventos que produce, o la respuesta que recibe solo su autor. Es pura: la solución,
// la hora y el modo llegan como argumentos, y el estado nunca guarda la solución (R-31). La usan el
// servidor y el servidor simulado del cliente. Las salas, la cola y la idempotencia son
// del servidor.
import { GRADER_VERSION, checkPlacement, digitBit, levelToDeduce } from "@sudoku-killer/engine";
import type { ClientMessage, Connection, ErrorCode, ServerMessage } from "@sudoku-killer/protocol";
import { cellCountOf, noteKey, valuesOf } from "./board.ts";
import type { MatchEvent, PlayerEntry } from "./events.ts";
import type { GameMode } from "./mode.ts";
import type { MatchState, PlayerId } from "./types.ts";
import { apply } from "./apply.ts";

/** Comandos de juego: los que llegan del cliente durante una partida. */
export type GameCommandType =
  "cell.place" | "hint.use" | "note.add" | "note.remove" | "note.undo" | "settings.update";

export type GameCommand = ClientMessage<GameCommandType>;

export const GAME_COMMAND_TYPES: readonly GameCommandType[] = [
  "cell.place",
  "hint.use",
  "note.add",
  "note.remove",
  "note.undo",
  "settings.update",
];

export interface DecideContext {
  readonly mode: GameMode;
  /** `size²` dígitos. Solo la conoce quien decide; nunca entra en un evento ni en el estado. */
  readonly solution: readonly number[];
  /** Hora del servidor. */
  readonly at: number;
}

/** Respuesta solo para el autor, sin eventos (SPEC §4.3). */
export type Reply =
  | Pick<ServerMessage<"cell.already_solved">, "type" | "payload">
  | Pick<ServerMessage<"ack">, "type" | "payload">
  | Pick<ServerMessage<"error">, "type" | "payload">;

export type Decision =
  | { readonly ok: true; readonly events: readonly MatchEvent[] }
  | { readonly ok: false; readonly reply: Reply };

const fail = (code: ErrorCode, reason?: string): Decision => ({
  ok: false,
  reply: { type: "error", payload: reason === undefined ? { code } : { code, reason } },
});
const notApplied: Decision = { ok: false, reply: { type: "ack", payload: { applied: false } } };
const alreadySolved = (cell: number): Decision => ({
  ok: false,
  reply: { type: "cell.already_solved", payload: { cell } },
});

type Draft = MatchEvent extends infer E
  ? E extends MatchEvent
    ? Omit<E, "seq" | "ts">
    : never
  : never;

/**
 * Numera los eventos y, si la partida termina con ellos, agrega `match.ended` (R-01): victoria al
 * bloquear la última celda, derrota cuando no queda ningún jugador activo (D4).
 */
function withOutcome(
  state: MatchState,
  drafts: readonly Draft[],
  mode: GameMode,
  at: number,
): Decision {
  const puzzle = state.puzzle;
  const events: MatchEvent[] = [];
  let next = state;
  for (const draft of drafts) {
    const event = { ...draft, seq: next.seq + 1, ts: at } as MatchEvent;
    events.push(event);
    next = apply(next, event, { mode, puzzle });
  }
  const result = mode.outcome(next);
  if (result !== null) {
    events.push({ type: "match.ended", payload: { result }, seq: next.seq + 1, ts: at });
  }
  return { ok: true, events };
}

/** Decide un comando de juego del jugador `playerId`. */
export function decide(
  state: MatchState,
  playerId: PlayerId,
  command: GameCommand,
  { mode, solution, at }: DecideContext,
): Decision {
  if (state.endedAt !== null) return fail("match.not_running");
  const player = state.players.get(playerId);
  if (!player) return fail("forbidden");
  const clientMsgId = command.id;
  const cellCount = cellCountOf(state.puzzle);
  const inBoard = (cell: number, digit?: number) =>
    cell < cellCount && (digit === undefined || digit <= state.puzzle.size);

  switch (command.type) {
    case "cell.place": {
      const { cell, digit } = command.payload;
      if (!inBoard(cell, digit)) return fail("bad_request");
      if (!mode.can(player.role, "place")) return fail("forbidden");
      if (state.cells[cell]?.status === "locked") return alreadySolved(cell);
      if (checkPlacement(solution, cell, digit) === "mistake") {
        return withOutcome(
          state,
          [{ type: "cell.mistake", payload: { playerId, cell, digit, clientMsgId } }],
          mode,
          at,
        );
      }
      const level = levelToDeduce(cell, {
        puzzle: state.puzzle,
        values: valuesOf(state.cells),
        excluded: state.excluded,
      });
      return withOutcome(
        state,
        [
          {
            type: "cell.solved",
            payload: {
              playerId,
              cell,
              value: digit,
              level,
              graderVersion: GRADER_VERSION,
              clientMsgId,
            },
          },
        ],
        mode,
        at,
      );
    }
    case "hint.use": {
      const { cell } = command.payload;
      if (!inBoard(cell)) return fail("bad_request");
      if (!mode.can(player.role, "hint")) return fail("forbidden");
      if (state.cells[cell]?.status === "locked") return alreadySolved(cell);
      if (state.hintsLeft <= 0) return fail("hint.none_left");
      const value = solution[cell];
      if (value === undefined) return fail("bad_request");
      return withOutcome(
        state,
        [{ type: "hint.used", payload: { playerId, cell, value, clientMsgId } }],
        mode,
        at,
      );
    }
    case "note.add":
    case "note.remove": {
      const { layer, cell, digit } = command.payload;
      if (!inBoard(cell, digit)) return fail("bad_request");
      if (!mode.can(player.role, layer === "group" ? "note.group" : "note.personal")) {
        return fail("forbidden");
      }
      if (state.cells[cell]?.status === "locked") return fail("cell.locked");
      const notes = layer === "group" ? state.groupNotes : player.personalNotes;
      const present = ((notes[cell] ?? 0) & digitBit(digit)) !== 0;
      const op = command.type === "note.add" ? "add" : "remove";
      if (present === (op === "add")) return notApplied;
      const ownerId = layer === "group" ? null : playerId;
      return withOutcome(
        state,
        [{ type: "note.op", payload: { layer, ownerId, playerId, cell, digit, op, clientMsgId } }],
        mode,
        at,
      );
    }
    case "note.undo": {
      const { opSeq } = command.payload;
      const record = state.noteOps.get(opSeq);
      if (!record) return fail("undo.not_applicable", "unknown_op");
      if (record.playerId !== playerId) return fail("undo.not_applicable", "not_owner");
      if (!mode.can(player.role, "note.undo")) return fail("forbidden");
      const { layer, ownerId, cell, digit } = record;
      const modified =
        state.cells[cell]?.status === "locked" ||
        state.lastNoteOp.get(noteKey(layer, ownerId, cell, digit)) !== opSeq;
      if (modified) return fail("undo.not_applicable", "modified");
      const op = record.op === "add" ? "remove" : "add";
      return withOutcome(
        state,
        [
          {
            type: "note.op",
            payload: { layer, ownerId, playerId, cell, digit, op, clientMsgId, undoOf: opSeq },
          },
        ],
        mode,
        at,
      );
    }
    case "settings.update": {
      const { autoCleanPersonalNotes } = command.payload;
      return withOutcome(
        state,
        [{ type: "settings.changed", payload: { playerId, autoCleanPersonalNotes, clientMsgId } }],
        mode,
        at,
      );
    }
  }
}

/** Entrada nueva a mitad de partida (R-12): activo, con las vidas iniciales y 0 puntos. */
export function decideJoin(
  state: MatchState,
  entry: PlayerEntry,
  mode: GameMode,
  at: number,
): Decision {
  if (state.endedAt !== null) return fail("match.not_running");
  if (state.players.has(entry.playerId)) return fail("bad_request");
  return withOutcome(state, [{ type: "player.joined", payload: entry }], mode, at);
}

/** Cambio de conexión de un jugador (SPEC §3.2): puede terminar la partida en derrota (D4). */
export function decideConnection(
  state: MatchState,
  change: {
    readonly playerId: PlayerId;
    readonly connection: Connection;
    readonly seat: number | null;
  },
  mode: GameMode,
  at: number,
): Decision {
  if (!state.players.has(change.playerId)) return fail("bad_request");
  if (state.endedAt !== null) {
    // Después del fin se sigue registrando la conexión, pero no cambia el resultado.
    const event = {
      type: "player.connection",
      payload: change,
      seq: state.seq + 1,
      ts: at,
    } as const;
    return { ok: true, events: [event] };
  }
  return withOutcome(state, [{ type: "player.connection", payload: change }], mode, at);
}

/** Traspaso del derecho de iniciar (R-11). */
export function decideStarter(state: MatchState, playerId: PlayerId | null, at: number): Decision {
  return {
    ok: true,
    events: [{ type: "starter.changed", payload: { playerId }, seq: state.seq + 1, ts: at }],
  };
}
