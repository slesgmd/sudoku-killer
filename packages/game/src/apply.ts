// Reductor puro de la partida (ADR 0004): `apply(estado, evento) → estado`. Lo usan igual el
// servidor en vivo, la reconstrucción tras un reinicio, el recálculo de puntajes y el servidor
// simulado del cliente. No modifica el estado de entrada.
import { cleanupPeers, clearCellNotes, digitBit, type NoteRemoval } from "@sudoku-killer/engine";
import type { ClosedUnit, ScoreChange } from "@sudoku-killer/scoring";
import type { PublicPuzzle } from "@sudoku-killer/protocol";
import { cellCountOf, closedUnitsOf, noteKey } from "./board.ts";
import type { EventOfType, MatchEvent, MatchStartedEvent, PlayerEntry } from "./events.ts";
import type { GameMode, PlacementContext } from "./mode.ts";
import type { CellState, MatchPlayer, MatchState, PlayerId } from "./types.ts";

export interface ReducerContext {
  readonly mode: GameMode;
  /** El puzzle de `match.started.puzzleId` (sin la solución). */
  readonly puzzle: PublicPuzzle;
}

/** Lo que un evento produjo además del estado: lo usa `project.ts` para los mensajes. */
export interface Effects {
  readonly changes: readonly ScoreChange[];
  readonly closedUnits: readonly ClosedUnit[];
}

const NO_EFFECTS: Effects = { changes: [], closedUnits: [] };

function newPlayer(entry: PlayerEntry, mode: GameMode, cellCount: number): MatchPlayer {
  return {
    id: entry.playerId,
    nickname: entry.nickname,
    seat: entry.seat,
    joinedAt: entry.joinedAt,
    tokenHash: entry.tokenHash,
    connection: entry.connection,
    settings: { autoCleanPersonalNotes: entry.autoCleanPersonalNotes },
    role: "active",
    lives: mode.rules.initialLives,
    score: 0,
    mistakes: 0,
    scoreReachedAt: null,
    personalNotes: new Uint16Array(cellCount),
  };
}

/** Estado inicial desde `match.started`: los números iniciales ya bloqueados (R-15). */
export function initialState(
  event: MatchStartedEvent,
  { mode, puzzle }: ReducerContext,
): MatchState {
  const { payload } = event;
  if (payload.puzzleId !== puzzle.id) {
    throw new Error(`match.started is for puzzle ${payload.puzzleId}, not ${puzzle.id}`);
  }
  const cellCount = cellCountOf(puzzle);
  const cells: CellState[] = Array.from({ length: cellCount }, () => ({ status: "empty" }));
  for (const { cell, value } of puzzle.givens) {
    cells[cell] = { status: "locked", value, source: "given", by: null, seq: 0 };
  }
  return {
    id: payload.matchId,
    puzzle,
    modeId: payload.modeId,
    scoringParamsVersion: payload.scoringParamsVersion,
    startedAt: event.ts,
    endedAt: null,
    result: null,
    seq: event.seq,
    starterId: payload.starterId,
    cells,
    groupNotes: new Uint16Array(cellCount),
    hintsLeft: payload.hintsTotal,
    excluded: [],
    lastNoteOp: new Map(),
    noteOps: new Map(),
    players: new Map(
      payload.players.map((entry) => [entry.playerId, newPlayer(entry, mode, cellCount)]),
    ),
  };
}

function withPlayer(
  players: ReadonlyMap<PlayerId, MatchPlayer>,
  playerId: PlayerId,
  update: (player: MatchPlayer) => MatchPlayer,
): ReadonlyMap<PlayerId, MatchPlayer> {
  const player = players.get(playerId);
  if (!player) throw new Error(`Unknown player ${playerId}`);
  const next = new Map(players);
  next.set(playerId, update(player));
  return next;
}

function applyScore(
  players: ReadonlyMap<PlayerId, MatchPlayer>,
  changes: readonly ScoreChange[],
  at: number,
): ReadonlyMap<PlayerId, MatchPlayer> {
  let next = players;
  for (const { playerId, delta } of changes) {
    if (delta === 0) continue;
    next = withPlayer(next, playerId, (p) => ({
      ...p,
      score: p.score + delta,
      scoreReachedAt: Math.max(p.scoreReachedAt ?? at, at),
    }));
  }
  return next;
}

/** Bloquea una celda y aplica la limpieza automática en las dos capas (R-17, ADR 0005). */
function lockCell(
  state: MatchState,
  cell: number,
  locked: Extract<CellState, { status: "locked" }>,
): Pick<MatchState, "cells" | "groupNotes" | "players" | "lastNoteOp"> {
  const cells = state.cells.slice();
  cells[cell] = locked;
  const lastNoteOp = new Map(state.lastNoteOp);
  const touch = (
    removed: readonly NoteRemoval[],
    layer: "personal" | "group",
    ownerId: PlayerId | null,
  ) => {
    for (const r of removed) lastNoteOp.set(noteKey(layer, ownerId, r.cell, r.digit), locked.seq);
  };
  const group = cleanupPeers(state.puzzle, state.groupNotes, cell, locked.value);
  touch(group.removed, "group", null);
  const players = new Map(state.players);
  for (const [id, player] of state.players) {
    const personal = player.settings.autoCleanPersonalNotes
      ? cleanupPeers(state.puzzle, player.personalNotes, cell, locked.value)
      : clearCellNotes(player.personalNotes, cell);
    touch(personal.removed, "personal", id);
    if (personal.removed.length > 0) players.set(id, { ...player, personalNotes: personal.notes });
  }
  return { cells, groupNotes: group.notes, players, lastNoteOp };
}

function placementContext(
  state: MatchState,
  event: EventOfType<"cell.solved"> | EventOfType<"hint.used">,
  levelToDeduce: number,
): PlacementContext {
  const { playerId, cell, value } = event.payload;
  return {
    state,
    playerId,
    cell,
    value,
    at: event.ts,
    closedUnits: closedUnitsOf(state.puzzle, state.cells, cell),
    levelToDeduce,
  };
}

/** Aplica un evento y devuelve también sus efectos (puntos y unidades cerradas). */
export function applyWithEffects(
  state: MatchState,
  event: MatchEvent,
  { mode }: ReducerContext,
): { readonly state: MatchState; readonly effects: Effects } {
  if (event.seq <= state.seq) {
    throw new Error(`Event seq ${String(event.seq)} after ${String(state.seq)}`);
  }
  const base = { ...state, seq: event.seq };
  switch (event.type) {
    case "match.started":
      throw new Error("match.started only starts a match (initialState)");
    case "player.joined": {
      const players = new Map(state.players);
      players.set(
        event.payload.playerId,
        newPlayer(event.payload, mode, cellCountOf(state.puzzle)),
      );
      return { state: { ...base, players }, effects: NO_EFFECTS };
    }
    case "player.connection": {
      const { playerId, connection, seat } = event.payload;
      const players = withPlayer(state.players, playerId, (p) => ({ ...p, connection, seat }));
      return { state: { ...base, players }, effects: NO_EFFECTS };
    }
    case "starter.changed":
      return { state: { ...base, starterId: event.payload.playerId }, effects: NO_EFFECTS };
    case "settings.changed": {
      const { playerId, autoCleanPersonalNotes } = event.payload;
      const players = withPlayer(state.players, playerId, (p) => ({
        ...p,
        settings: { autoCleanPersonalNotes },
      }));
      return { state: { ...base, players }, effects: NO_EFFECTS };
    }
    case "cell.solved": {
      const { playerId, cell, value, level } = event.payload;
      const ctx = placementContext(state, event, level);
      const changes = mode.onCorrect(ctx);
      const locked = lockCell(base, cell, {
        status: "locked",
        value,
        source: "solved",
        by: playerId,
        seq: event.seq,
      });
      return {
        state: { ...base, ...locked, players: applyScore(locked.players, changes, event.ts) },
        effects: { changes, closedUnits: ctx.closedUnits },
      };
    }
    case "hint.used": {
      const { playerId, cell, value } = event.payload;
      // El nivel no se usa: la pista no puntúa por nivel ni da β (T-19.5).
      const ctx = placementContext(state, event, 0);
      const changes = mode.onHint(ctx);
      const locked = lockCell(base, cell, {
        status: "locked",
        value,
        source: "hint",
        by: playerId,
        seq: event.seq,
      });
      return {
        state: {
          ...base,
          ...locked,
          hintsLeft: state.hintsLeft - 1,
          players: applyScore(locked.players, changes, event.ts),
        },
        effects: { changes, closedUnits: ctx.closedUnits },
      };
    }
    case "cell.mistake": {
      const { playerId, cell, digit } = event.payload;
      const { score, livesDelta } = mode.onMistake({ state, playerId, cell, digit, at: event.ts });
      let players = withPlayer(state.players, playerId, (p) => {
        const lives = Math.max(0, p.lives + livesDelta);
        return { ...p, lives, mistakes: p.mistakes + 1, role: mode.roleAfterLives(lives) };
      });
      players = applyScore(players, score, event.ts);
      const known = state.excluded.some((e) => e.cell === cell && e.digit === digit);
      const excluded = known ? state.excluded : [...state.excluded, { cell, digit }];
      return {
        state: { ...base, players, excluded },
        effects: { changes: score, closedUnits: [] },
      };
    }
    case "note.op": {
      const { layer, ownerId, playerId, cell, digit, op } = event.payload;
      const bit = digitBit(digit);
      const flip = (notes: Uint16Array) => {
        const next = notes.slice();
        next[cell] = op === "add" ? (notes[cell] ?? 0) | bit : (notes[cell] ?? 0) & ~bit;
        return next;
      };
      const lastNoteOp = new Map(state.lastNoteOp).set(
        noteKey(layer, ownerId, cell, digit),
        event.seq,
      );
      const noteOps = new Map(state.noteOps).set(event.seq, {
        layer,
        ownerId,
        playerId,
        cell,
        digit,
        op,
      });
      if (layer === "group") {
        return {
          state: { ...base, groupNotes: flip(state.groupNotes), lastNoteOp, noteOps },
          effects: NO_EFFECTS,
        };
      }
      const players = withPlayer(state.players, ownerId ?? playerId, (p) => ({
        ...p,
        personalNotes: flip(p.personalNotes),
      }));
      return { state: { ...base, players, lastNoteOp, noteOps }, effects: NO_EFFECTS };
    }
    case "match.ended":
      return {
        state: { ...base, endedAt: event.ts, result: event.payload.result },
        effects: NO_EFFECTS,
      };
  }
}

export function apply(state: MatchState, event: MatchEvent, ctx: ReducerContext): MatchState {
  return applyWithEffects(state, event, ctx).state;
}

/** Reconstruye una partida desde su registro (R-32): el primer evento es `match.started`. */
export function replay(events: readonly MatchEvent[], ctx: ReducerContext): MatchState {
  const [first, ...rest] = events;
  if (first?.type !== "match.started") throw new Error("A match log starts with match.started");
  return rest.reduce((state, event) => apply(state, event, ctx), initialState(first, ctx));
}
