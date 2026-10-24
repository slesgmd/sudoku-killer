// Estado del cliente (ADR 0001: store propio, alimentado por el `Transport`). Es una vista de lo que
// el servidor confirmó, más lo pendiente: las jugadas de números no son optimistas (quedan
// pendientes hasta el veredicto) y las notas sí (confirmado + pendientes en orden, ADR 0005).
import { digitBit } from "@sudoku-killer/engine/model";
import type {
  Difficulty,
  LockedCell,
  MatchResult,
  NoteLayer,
  NoteOp,
  PublicPlayer,
  PublicPuzzle,
  RankingEntry,
  RoomState,
  Settings,
} from "@sudoku-killer/protocol";

export type Phase = "home" | "entering" | "loading" | "playing" | "ended";
export type InputMode = "number" | "notes";

export interface PendingNote {
  readonly id: string;
  readonly layer: NoteLayer;
  readonly op: NoteOp;
  readonly cell: number;
  readonly digit: number;
}

export interface Flash {
  readonly digit: number;
  readonly by: string;
  /** Distingue dos destellos seguidos en la misma celda. */
  readonly key: number;
}

/** `notice`: el texto de un aviso, para que quede en el historial (decisión 4). */
export type ActivityKind =
  "solved" | "mistake" | "hint" | "joined" | "left" | "spectator" | "notice";

export interface ActivityEntry {
  readonly key: number;
  readonly kind: ActivityKind;
  /** Texto del aviso (`notice`). */
  readonly text?: string;
  readonly playerId: string;
  readonly cell: number | null;
  /** Tiempo de partida, en milisegundos. */
  readonly elapsed: number;
}

export interface Toast {
  readonly id: number;
  /** `alert`: asertivo (errores propios); `status`: cortés. */
  readonly role: "alert" | "status";
  readonly text: string;
}

export interface MatchView {
  readonly id: string;
  readonly puzzle: PublicPuzzle;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly result: MatchResult | null;
  readonly hintsLeft: number;
  readonly hintsTotal: number;
  readonly ranking: readonly RankingEntry[] | null;
}

export interface ClientState {
  readonly phase: Phase;
  readonly playerId: string | null;
  readonly room: {
    readonly code: string;
    readonly state: RoomState;
    readonly starterId: string | null;
    readonly difficulty: Difficulty;
  } | null;
  readonly players: readonly PublicPlayer[];
  readonly settings: Settings;
  readonly match: MatchView | null;
  /** Celda → bloqueo, o null si está vacía. */
  readonly locked: readonly (Omit<LockedCell, "cell"> | null)[];
  readonly groupNotes: Uint16Array;
  readonly personalNotes: Uint16Array;
  readonly pendingNotes: readonly PendingNote[];
  /** Jugadas de números esperando el veredicto, por celda. */
  readonly pending: ReadonlyMap<number, { readonly id: string; readonly digit: number }>;
  readonly flashes: ReadonlyMap<number, Flash>;
  /** Celda seleccionada por cada compañero (R-24). */
  readonly presence: ReadonlyMap<string, number | null>;
  readonly activity: readonly ActivityEntry[];
  readonly toasts: readonly Toast[];
  readonly selected: number | null;
  readonly mode: InputMode;
  readonly layer: NoteLayer;
  readonly visible: { readonly personal: boolean; readonly group: boolean };
  /** «Usar notas»: preferencia local del cliente (prefs.ts). Sin notas no hay controles ni notas. */
  readonly notesEnabled: boolean;
  /** Hora del servidor − hora del cliente, medida con `sys.ping` (T-07.2). */
  readonly clockOffset: number;
  readonly canUndo: boolean;
  /** Error al entrar (código del protocolo). */
  readonly enterError: string | null;
  /** El último arranque pedido: el inicio lo conserva para «Reintentar» y al volver (T-37.1). */
  readonly lastStart: { readonly nickname: string; readonly difficulty: Difficulty } | null;
  /** La entrada o la carga de la partida fallaron, o no terminaron a tiempo (T-37.1). */
  readonly startFailed: boolean;
}

export const INITIAL_STATE: ClientState = {
  phase: "home",
  playerId: null,
  room: null,
  players: [],
  settings: { autoCleanPersonalNotes: true },
  match: null,
  locked: [],
  groupNotes: new Uint16Array(0),
  personalNotes: new Uint16Array(0),
  pendingNotes: [],
  pending: new Map(),
  flashes: new Map(),
  presence: new Map(),
  activity: [],
  toasts: [],
  selected: null,
  mode: "number",
  layer: "personal",
  visible: { personal: true, group: true },
  notesEnabled: true,
  clockOffset: 0,
  canUndo: false,
  enterError: null,
  lastStart: null,
  startFailed: false,
};

/** Notas de una capa tal como se ven: lo confirmado más las pendientes, en orden (ADR 0005). */
export function viewNotes(state: ClientState, layer: NoteLayer): Uint16Array {
  const notes = (layer === "group" ? state.groupNotes : state.personalNotes).slice();
  for (const op of state.pendingNotes) {
    if (op.layer !== layer) continue;
    const bit = digitBit(op.digit);
    notes[op.cell] = op.op === "add" ? (notes[op.cell] ?? 0) | bit : (notes[op.cell] ?? 0) & ~bit;
  }
  return notes;
}

export function me(state: ClientState): PublicPlayer | undefined {
  return state.players.find((p) => p.id === state.playerId);
}

export function playerName(state: ClientState, playerId: string | null): string {
  return state.players.find((p) => p.id === playerId)?.nickname ?? "";
}

/** Cuántas veces falta colocar cada dígito (índice 1..size). */
export function remainingByDigit(state: ClientState): number[] {
  const size = state.match?.puzzle.size ?? 9;
  const remaining = new Array<number>(size + 1).fill(size);
  remaining[0] = 0;
  for (const cell of state.locked) {
    if (cell) remaining[cell.value] = (remaining[cell.value] ?? 0) - 1;
  }
  return remaining;
}

/** Tiempo de partida en milisegundos, con la hora del servidor estimada. */
export function elapsedMs(state: ClientState, clientNow: number): number {
  const match = state.match;
  if (!match) return 0;
  const end = match.endedAt ?? clientNow + state.clockOffset;
  return Math.max(0, end - match.startedAt);
}

/** «MM:SS», o «H:MM:SS» desde la hora. */
export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${String(hours)}:${two(minutes)}:${two(seconds)}`
    : `${two(minutes)}:${two(seconds)}`;
}
