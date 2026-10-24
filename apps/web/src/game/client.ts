// Controlador del cliente: convierte las acciones de la interfaz en mensajes del protocolo y los
// mensajes del servidor en estado. El `Transport` y el reloj se inyectan (T-07.2).
import { cleanupPeers, clearCellNotes, digitBit } from "@sudoku-killer/engine/model";
import { NORMAL_RULES, normalCan } from "@sudoku-killer/game/client";
import type {
  ClientMessage,
  ClientMessageType,
  Difficulty,
  NoteLayer,
  PublicPlayer,
  ServerEnvelope,
  ServerMessage,
} from "@sudoku-killer/protocol";
import { t } from "../i18n/index.ts";
import type { Transport } from "../transport/types.ts";
import {
  INITIAL_STATE,
  me,
  playerName,
  viewNotes,
  type ActivityKind,
  type ClientState,
  type InputMode,
  type PendingNote,
  type Toast,
} from "./state.ts";

/** Duración del destello de un error (`--t-error-flash`, T-04.3). */
export const ERROR_FLASH_MS = 1500;
/** Ping de aplicación (SPEC §4.8). */
export const PING_INTERVAL_MS = 5000;
/** Muestras de reloj que se guardan; gana la de menor ida y vuelta. */
const CLOCK_SAMPLES = 8;
/** Grupos de deshacer guardados (ADR 0005). */
const UNDO_LIMIT = 50;

export interface GameClientOptions {
  readonly transport: Transport;
  /** Reloj del cliente; puede estar desfasado respecto del servidor. */
  readonly now?: () => number;
}

interface UndoGroup {
  /** Mensajes de la acción que todavía no tienen `opSeq`. */
  readonly waiting: Set<string>;
  readonly opSeqs: number[];
  readonly cells: Map<number, { layer: NoteLayer; cell: number }>;
}

interface UndoRun {
  readonly awaiting: Map<string, { layer: NoteLayer; cell: number }>;
  readonly total: number;
  done: number;
  readonly failures: { layer: NoteLayer; cell: number }[];
}

/** «F2 C7». */
export function cellName(cell: number, size: number): string {
  return t("cell.short", { row: Math.floor(cell / size) + 1, col: (cell % size) + 1 });
}

export class GameClient {
  private state: ClientState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private readonly transport: Transport;
  private readonly now: () => number;
  private readonly unsubscribe: () => void;
  private nextId = 1;
  private readonly idPrefix: string;
  private nextKey = 1;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly clockSamples: { rtt: number; offset: number }[] = [];
  private startRequest: { id: string; difficulty: Difficulty } | null = null;
  private readonly undoStack: UndoGroup[] = [];
  private undoRun: UndoRun | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor({ transport, now = () => Date.now() }: GameClientOptions) {
    this.transport = transport;
    this.now = now;
    this.idPrefix = Math.floor(now()).toString(36);
    this.unsubscribe = transport.subscribe((message) => {
      this.receive(message);
    });
  }

  // --- Store ---

  getState = (): ClientState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(patch: Partial<ClientState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  /** Hora del servidor estimada. */
  serverNow(): number {
    return this.now() + this.state.clockOffset;
  }

  clientNow(): number {
    return this.now();
  }

  destroy(): void {
    this.unsubscribe();
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    for (const timer of this.timers) clearTimeout(timer);
    this.transport.close();
  }

  // --- Envío ---

  private send<T extends ClientMessageType>(type: T, payload: ClientMessage<T>["payload"]): string {
    const id = `${this.idPrefix}-${String(this.nextId++)}`;
    this.transport.send({ v: 1, id, type, payload } as ClientMessage);
    return id;
  }

  private later(fn: () => void, ms: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
  }

  private ping(): void {
    this.send("sys.ping", { t0: Math.max(0, Math.floor(this.now())) });
  }

  // --- Acciones de la interfaz ---

  /** Inicio mínimo de F8: crea la sala, elige la dificultad e inicia la partida. */
  start(nickname: string, difficulty: Difficulty): void {
    this.set({ ...INITIAL_STATE, phase: "entering" });
    this.startRequest = { id: this.send("room.create", { nickname }), difficulty };
    if (this.pingTimer === null) {
      this.ping();
      this.pingTimer = setInterval(() => {
        this.ping();
      }, PING_INTERVAL_MS);
    }
  }

  leave(): void {
    this.send("room.leave", {});
    this.backHome();
  }

  backHome(): void {
    this.undoStack.length = 0;
    this.undoRun = null;
    this.set({ ...INITIAL_STATE, settings: this.state.settings });
  }

  select(cell: number | null): void {
    if (this.state.selected === cell) return;
    this.set({ selected: cell });
    if (this.state.phase === "playing") this.send("presence.select", { cell });
  }

  /** Mueve la selección con las flechas. */
  move(dRow: number, dCol: number): void {
    const size = this.state.match?.puzzle.size;
    if (size === undefined) return;
    const current = this.state.selected ?? 0;
    const row = Math.min(size - 1, Math.max(0, Math.floor(current / size) + dRow));
    const col = Math.min(size - 1, Math.max(0, (current % size) + dCol));
    this.select(row * size + col);
  }

  setMode(mode: InputMode): void {
    this.set({ mode });
  }

  toggleMode(): void {
    if (!this.canPlace()) {
      this.set({ mode: "notes" });
      return;
    }
    this.set({ mode: this.state.mode === "number" ? "notes" : "number" });
  }

  setLayer(layer: NoteLayer): void {
    this.set({ layer });
  }

  toggleLayer(): void {
    this.set({ layer: this.state.layer === "personal" ? "group" : "personal" });
  }

  toggleVisible(layer: NoteLayer): void {
    this.set({ visible: { ...this.state.visible, [layer]: !this.state.visible[layer] } });
  }

  dismissToast(id: number): void {
    this.set({ toasts: this.state.toasts.filter((toast) => toast.id !== id) });
  }

  setAutoClean(autoCleanPersonalNotes: boolean): void {
    this.set({ settings: { autoCleanPersonalNotes } });
    this.send("settings.update", { autoCleanPersonalNotes });
  }

  /** Si el jugador puede colocar números ahora (activo y con la partida en curso). */
  canPlace(): boolean {
    const role = me(this.state)?.role;
    return (
      this.state.phase === "playing" &&
      role !== null &&
      role !== undefined &&
      normalCan(role, "place")
    );
  }

  /** Celda seleccionada vacía, sin jugada pendiente. */
  private editableCell(): number | null {
    const cell = this.state.selected;
    if (this.state.phase !== "playing" || cell === null) return null;
    if (this.state.locked[cell] || this.state.pending.has(cell)) return null;
    return cell;
  }

  /** Tecla 1–9: número o nota según el modo. No se bloquea un error evidente (T-28.2). */
  input(digit: number): void {
    const cell = this.editableCell();
    if (cell === null) return;
    if (this.state.mode === "number" && this.canPlace()) {
      const id = this.send("cell.place", { cell, digit });
      const pending = new Map(this.state.pending).set(cell, { id, digit });
      this.set({ pending });
      return;
    }
    if (this.state.mode === "notes" || !this.canPlace()) {
      const layer = this.state.layer;
      const present = ((viewNotes(this.state, layer)[cell] ?? 0) & digitBit(digit)) !== 0;
      this.noteOps([{ layer, op: present ? "remove" : "add", cell, digit }]);
    }
  }

  /** «Borrar»: quita las notas de la capa activa en la celda (un grupo de deshacer, decisión 5). */
  clearNotes(): void {
    const cell = this.editableCell();
    if (cell === null) return;
    const layer = this.state.layer;
    const mask = viewNotes(this.state, layer)[cell] ?? 0;
    const ops: Omit<PendingNote, "id">[] = [];
    for (let digit = 1; digit <= (this.state.match?.puzzle.size ?? 9); digit++) {
      if (mask & digitBit(digit)) ops.push({ layer, op: "remove", cell, digit });
    }
    if (ops.length > 0) this.noteOps(ops);
  }

  private noteOps(ops: readonly Omit<PendingNote, "id">[]): void {
    const group: UndoGroup = { waiting: new Set(), opSeqs: [], cells: new Map() };
    const pendingNotes = [...this.state.pendingNotes];
    for (const op of ops) {
      const id = this.send(op.op === "add" ? "note.add" : "note.remove", {
        layer: op.layer,
        cell: op.cell,
        digit: op.digit,
      });
      group.waiting.add(id);
      pendingNotes.push({ ...op, id });
    }
    this.undoStack.push(group);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.set({ pendingNotes, canUndo: true });
  }

  /** Ctrl+Z: deshace el último grupo de notas propio (R-25, decisión 5). */
  undo(): void {
    if (this.undoRun) return;
    const group = this.undoStack.pop();
    this.set({ canUndo: this.undoStack.length > 0 });
    if (!group || group.opSeqs.length === 0) {
      if (!group) this.toast("status", t("state.nothingToUndo"));
      return;
    }
    const run: UndoRun = { awaiting: new Map(), total: group.opSeqs.length, done: 0, failures: [] };
    for (const opSeq of [...group.opSeqs].reverse()) {
      const id = this.send("note.undo", { opSeq });
      run.awaiting.set(id, group.cells.get(opSeq) ?? { layer: "group", cell: -1 });
    }
    this.undoRun = run;
  }

  /** Pista confirmada sobre la celda seleccionada (R-19). */
  useHint(): void {
    const cell = this.editableCell();
    if (cell === null || !this.canPlace() || (this.state.match?.hintsLeft ?? 0) <= 0) return;
    const id = this.send("hint.use", { cell });
    this.set({ pending: new Map(this.state.pending).set(cell, { id, digit: 0 }) });
  }

  // --- Avisos y actividad ---

  private toast(role: Toast["role"], text: string): void {
    this.set({ toasts: [...this.state.toasts, { id: this.nextKey++, role, text }] });
  }

  private log(kind: ActivityKind, playerId: string, cell: number | null): void {
    const startedAt = this.state.match?.startedAt ?? this.serverNow();
    const entry = {
      key: this.nextKey++,
      kind,
      playerId,
      cell,
      elapsed: Math.max(0, this.serverNow() - startedAt),
    };
    this.set({ activity: [...this.state.activity, entry] });
  }

  private cellName(cell: number): string {
    return cellName(cell, this.state.match?.puzzle.size ?? 9);
  }

  // --- Mensajes del servidor ---

  private receive(message: ServerEnvelope): void {
    const mine = message.replyTo !== undefined;
    switch (message.type) {
      case "room.welcome": {
        this.onWelcome(message);
        return;
      }
      case "room.player_joined": {
        this.upsertPlayer(message.payload.player);
        return;
      }
      case "room.player_connection": {
        const { playerId, connection, seat } = message.payload;
        const player = this.state.players.find((p) => p.id === playerId);
        if (player) this.upsertPlayer({ ...player, connection, seat });
        if (connection === "left" && player) this.log("left", playerId, null);
        return;
      }
      case "room.player_removed": {
        this.set({
          players: this.state.players.filter((p) => p.id !== message.payload.playerId),
        });
        return;
      }
      case "room.starter_changed":
        if (this.state.room)
          this.set({ room: { ...this.state.room, starterId: message.payload.playerId } });
        return;
      case "room.difficulty_set":
        if (this.state.room)
          this.set({ room: { ...this.state.room, difficulty: message.payload.difficulty } });
        return;
      case "room.state_changed":
        if (this.state.room)
          this.set({ room: { ...this.state.room, state: message.payload.state } });
        return;
      case "match.started": {
        this.onMatchStarted(message.payload);
        return;
      }
      case "cell.solved":
      case "hint.used": {
        this.onLocked(message);
        return;
      }
      case "cell.mistake": {
        this.onMistake(message, mine);
        return;
      }
      case "cell.already_solved": {
        this.onAlreadySolved(message.payload.cell);
        return;
      }
      case "note.applied": {
        this.onNoteApplied(message);
        return;
      }
      case "presence.updated": {
        this.set({
          presence: new Map(this.state.presence).set(
            message.payload.playerId,
            message.payload.cell,
          ),
        });
        return;
      }
      case "match.ended": {
        this.onEnded(message.payload);
        return;
      }
      case "ack": {
        this.onAck(message);
        return;
      }
      case "error": {
        this.onError(message);
        return;
      }
      case "sys.pong": {
        this.onPong(message.payload);
        return;
      }
    }
  }

  private upsertPlayer(player: PublicPlayer): void {
    const exists = this.state.players.some((p) => p.id === player.id);
    const players = exists
      ? this.state.players.map((p) => (p.id === player.id ? player : p))
      : [...this.state.players, player];
    this.set({ players });
  }

  private onWelcome(message: ServerMessage<"room.welcome">): void {
    const { playerId, snapshot } = message.payload;
    const { room, match, you } = snapshot;
    this.setOffsetFromSnapshot(snapshot.serverNow);
    this.set({
      playerId,
      room: {
        code: room.code,
        state: room.state,
        starterId: room.starterId,
        difficulty: room.difficulty,
      },
      players: room.players,
      settings: you.settings,
      phase: match ? (match.endedAt === null ? "playing" : "ended") : "loading",
    });
    if (match) {
      const size = match.puzzle.size;
      const cells = size * size;
      const locked: ClientState["locked"][number][] = new Array<null>(cells).fill(null);
      for (const { cell, ...rest } of match.locked) locked[cell] = rest;
      const notes = (list: readonly { cell: number; mask: number }[]) => {
        const array = new Uint16Array(cells);
        for (const { cell, mask } of list) array[cell] = mask;
        return array;
      };
      this.set({
        match: { ...match, hintsTotal: NORMAL_RULES.teamHints },
        locked,
        groupNotes: notes(match.groupNotes),
        personalNotes: notes(you.personalNotes),
      });
    }
    const request = this.startRequest;
    if (request && message.replyTo === request.id) {
      this.startRequest = null;
      this.send("room.set_difficulty", { difficulty: request.difficulty });
      this.send("match.start", {});
    }
  }

  private onMatchStarted(payload: ServerMessage<"match.started">["payload"]): void {
    const { puzzle } = payload;
    const cells = puzzle.size * puzzle.size;
    const locked: ClientState["locked"][number][] = new Array<null>(cells).fill(null);
    for (const { cell, value } of puzzle.givens)
      locked[cell] = { value, source: "given", by: null };
    this.undoStack.length = 0;
    this.set({
      phase: "playing",
      players: payload.players,
      match: {
        id: payload.matchId,
        puzzle,
        startedAt: payload.startedAt,
        endedAt: null,
        result: null,
        hintsLeft: payload.hintsLeft,
        hintsTotal: payload.hintsLeft,
        ranking: null,
      },
      locked,
      groupNotes: new Uint16Array(cells),
      personalNotes: new Uint16Array(cells),
      pendingNotes: [],
      pending: new Map(),
      flashes: new Map(),
      activity: [],
      selected: null,
      mode: "number",
      canUndo: false,
    });
  }

  private onLocked(message: ServerMessage<"cell.solved"> | ServerMessage<"hint.used">): void {
    const match = this.state.match;
    if (!match) return;
    const { cell, value, by, score } = message.payload;
    const hint = message.type === "hint.used";
    const locked = [...this.state.locked];
    locked[cell] = { value, source: hint ? "hint" : "solved", by };
    // La misma limpieza que aplica el servidor (R-17, ADR 0005).
    const group = cleanupPeers(match.puzzle, this.state.groupNotes, cell, value).notes;
    const personal = this.state.settings.autoCleanPersonalNotes
      ? cleanupPeers(match.puzzle, this.state.personalNotes, cell, value).notes
      : clearCellNotes(this.state.personalNotes, cell).notes;
    const pending = new Map(this.state.pending);
    pending.delete(cell);
    const flashes = new Map(this.state.flashes);
    flashes.delete(cell);
    const player = this.state.players.find((p) => p.id === by);
    this.set({
      locked,
      groupNotes: group,
      personalNotes: personal,
      pendingNotes: this.state.pendingNotes.filter((op) => op.cell !== cell),
      pending,
      flashes,
      match: hint ? { ...match, hintsLeft: message.payload.hintsLeft } : match,
      players: player
        ? this.state.players.map((p) => (p.id === by ? { ...p, score } : p))
        : this.state.players,
    });
    this.log(hint ? "hint" : "solved", by, cell);
  }

  private onMistake(message: ServerMessage<"cell.mistake">, mine: boolean): void {
    const { cell, digit, by, score, livesLeft, role } = message.payload;
    const before = this.state.players.find((p) => p.id === by);
    const key = this.nextKey++;
    const pending = new Map(this.state.pending);
    if (mine) pending.delete(cell);
    this.set({
      flashes: new Map(this.state.flashes).set(cell, { digit, by, key }),
      pending,
      players: this.state.players.map((p) =>
        p.id === by ? { ...p, score, lives: livesLeft, role, mistakes: p.mistakes + 1 } : p,
      ),
    });
    this.later(() => {
      if (this.state.flashes.get(cell)?.key !== key) return;
      const flashes = new Map(this.state.flashes);
      flashes.delete(cell);
      this.set({ flashes });
    }, ERROR_FLASH_MS);
    this.log("mistake", by, cell);
    const becameSpectator = before?.role === "active" && role === "spectator";
    if (becameSpectator) this.log("spectator", by, null);
    if (by !== this.state.playerId) return;
    if (becameSpectator) {
      this.set({ mode: "notes" });
      this.toast("alert", t("state.nowSpectator"));
    } else {
      const lives = t("state.livesLeft", { count: livesLeft });
      this.toast("alert", t("state.ownMistake", { digit, cell: this.cellName(cell), lives }));
    }
  }

  private onAlreadySolved(cell: number): void {
    const pending = new Map(this.state.pending);
    pending.delete(cell);
    this.set({ pending });
    const by = this.state.locked[cell]?.by ?? null;
    const name = playerName(this.state, by);
    this.toast(
      "status",
      name
        ? t("state.alreadySolved", { name, cell: this.cellName(cell) })
        : t("state.alreadySolvedAnon", { cell: this.cellName(cell) }),
    );
  }

  private onNoteApplied(message: ServerMessage<"note.applied">): void {
    const { layer, op, cell, digit, opSeq, undoOf } = message.payload;
    const bit = digitBit(digit);
    const apply = (notes: Uint16Array) => {
      const next = notes.slice();
      next[cell] = op === "add" ? (notes[cell] ?? 0) | bit : (notes[cell] ?? 0) & ~bit;
      return next;
    };
    const patch: { -readonly [K in keyof ClientState]?: ClientState[K] } =
      layer === "group"
        ? { groupNotes: apply(this.state.groupNotes) }
        : { personalNotes: apply(this.state.personalNotes) };
    const replyTo = message.replyTo;
    if (replyTo !== undefined) {
      patch.pendingNotes = this.state.pendingNotes.filter((pending) => pending.id !== replyTo);
      if (undoOf === undefined) {
        const group = this.undoStack.find((g) => g.waiting.has(replyTo));
        if (group) {
          group.waiting.delete(replyTo);
          group.opSeqs.push(opSeq);
          group.cells.set(opSeq, { layer, cell });
        }
      } else {
        this.undoResult(replyTo, true);
      }
    }
    this.set(patch);
  }

  private onAck(message: ServerMessage<"ack">): void {
    const replyTo = message.replyTo;
    if (replyTo === undefined) return;
    // Una nota sin efecto: se quita de las pendientes y de su grupo de deshacer.
    if (this.state.pendingNotes.some((op) => op.id === replyTo)) {
      this.set({ pendingNotes: this.state.pendingNotes.filter((op) => op.id !== replyTo) });
      this.forgetUndo(replyTo);
    }
  }

  private forgetUndo(id: string): void {
    const index = this.undoStack.findIndex((g) => g.waiting.has(id));
    const group = this.undoStack[index];
    if (!group) return;
    group.waiting.delete(id);
    if (group.waiting.size === 0 && group.opSeqs.length === 0) this.undoStack.splice(index, 1);
    this.set({ canUndo: this.undoStack.length > 0 });
  }

  private undoResult(id: string, ok: boolean): void {
    const run = this.undoRun;
    const target = run?.awaiting.get(id);
    if (!run || !target) return;
    run.awaiting.delete(id);
    if (ok) run.done++;
    else run.failures.push(target);
    if (run.awaiting.size > 0) return;
    this.undoRun = null;
    if (run.total > 1) {
      const rest = run.total - run.done;
      const text = t("state.recovered", { done: run.done, total: run.total });
      this.toast(
        "status",
        rest > 0 ? `${text} ${t("state.recoveredRest", { count: rest })}` : text,
      );
    } else if (!ok) {
      const locked =
        this.state.locked[target.cell] !== null && this.state.locked[target.cell] !== undefined;
      this.toast(
        "status",
        locked
          ? t("state.undoLocked")
          : target.layer === "group"
            ? t("state.undoModifiedGroup")
            : t("state.undoModifiedPersonal"),
      );
    }
  }

  private onError(message: ServerMessage<"error">): void {
    const replyTo = message.replyTo;
    const { code } = message.payload;
    if (this.state.phase === "entering") {
      this.set({ phase: "home", enterError: code });
      return;
    }
    if (replyTo === undefined) return;
    if (this.undoRun?.awaiting.has(replyTo)) {
      this.undoResult(replyTo, false);
      return;
    }
    if (this.state.pendingNotes.some((op) => op.id === replyTo)) {
      this.set({ pendingNotes: this.state.pendingNotes.filter((op) => op.id !== replyTo) });
      this.forgetUndo(replyTo);
      if (code === "rate_limited") this.toast("status", t("state.rateLimited"));
      return;
    }
    const placement = [...this.state.pending].find(([, p]) => p.id === replyTo);
    if (placement) {
      const pending = new Map(this.state.pending);
      pending.delete(placement[0]);
      this.set({ pending });
      const hint = placement[1].digit === 0;
      if (code === "forbidden")
        this.toast("alert", t(hint ? "state.hintForbidden" : "state.placeForbidden"));
      else if (code === "hint.none_left") this.toast("alert", t("state.hintNone"));
      else if (code === "rate_limited") this.toast("status", t("state.rateLimited"));
      else this.toast("alert", t("state.error", { code }));
    }
  }

  private onEnded(payload: ServerMessage<"match.ended">["payload"]): void {
    const match = this.state.match;
    if (!match) return;
    this.set({
      phase: "ended",
      match: {
        ...match,
        endedAt: payload.endedAt,
        result: payload.result,
        ranking: payload.ranking,
      },
      selected: null,
      pending: new Map(),
    });
  }

  // --- Reloj ---

  private setOffsetFromSnapshot(serverNow: number): void {
    if (this.clockSamples.length === 0) this.set({ clockOffset: serverNow - this.now() });
  }

  private onPong({ t0, serverNow }: { t0: number; serverNow: number }): void {
    const t1 = this.now();
    const rtt = Math.max(0, t1 - t0);
    this.clockSamples.push({ rtt, offset: serverNow - (t0 + t1) / 2 });
    if (this.clockSamples.length > CLOCK_SAMPLES) this.clockSamples.shift();
    const best = this.clockSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.set({ clockOffset: best.offset });
  }
}
