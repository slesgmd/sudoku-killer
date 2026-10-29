// Controlador del cliente: convierte las acciones de la interfaz en mensajes del protocolo y los
// mensajes del servidor en estado. El `Transport` y el reloj se inyectan (T-07.2).
import { cleanupPeers, clearCellNotes, digitBit } from "@sudoku-killer/engine/model";
import { NORMAL_RULES, normalCan } from "@sudoku-killer/game/client";
import type {
  ClientEnvelope,
  ClientMessage,
  ClientMessageType,
  Difficulty,
  NoteLayer,
  PublicPlayer,
  ServerEnvelope,
  ServerMessage,
} from "@sudoku-killer/protocol";
import { isValidAccessKey, normalizeAccessKey } from "@sudoku-killer/protocol";
import { t } from "../i18n/index.ts";
import type { Transport, TransportStatus } from "../transport/types.ts";
import { USE_NOTES_KEY, browserPrefs, type Prefs } from "./prefs.ts";
import { randomId } from "./random-id.ts";
import { applyNoteOp, withoutPending } from "./notes.ts";
import { browserSession, type SessionStore } from "./session.ts";
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
/** Sin `sys.pong` (ni otro mensaje) en este tiempo, se reconecta (ADR 0002). */
export const PONG_TIMEOUT_MS = 10_000;
/** Si la sala se está reconstruyendo (E-16), se vuelve a intentar entrar tras esta espera. */
export const REJOIN_RETRY_MS = 2000;
/** Muestras de reloj que se guardan; gana la de menor ida y vuelta. */
const CLOCK_SAMPLES = 8;
/**
 * Tiempo máximo para entrar y cargar la partida (T-37.1). La carga más lenta medida es de unos
 * 300 ms (docs/dificultad.md §5.1): el margen cubre un celular lento o un servidor con demora.
 */
export const START_TIMEOUT_MS = 15_000;
/**
 * Servidor dormido (ADR 0007): si la conexión no abre en 3 s al entrar, se avisa
 * «Despertando el servidor…» y se sigue intentando hasta 2 min (el hosting gratuito tarda alrededor
 * de un minuto en despertar). Después, el aviso de error con «Reintentar» (T-37.1).
 */
export const WAKE_NOTICE_MS = 3_000;
export const WAKE_TIMEOUT_MS = 120_000;
/** Sin respuesta de `POST /access`, se vuelve a preguntar tras esta espera, hasta `WAKE_TIMEOUT_MS`. */
export const ACCESS_RETRY_MS = 2_000;
/** Grupos de deshacer guardados (ADR 0005). */
const UNDO_LIMIT = 50;
/**
 * Comandos de partida que se guardan hasta su respuesta y se reenvían con el mismo `id` al volver
 * (E-07). Los de la sala (dificultad, iniciar, volver al lobby, salir) no: tras una reconexión, el
 * snapshot dice en qué estado quedó la sala y la interfaz los ofrece otra vez si hace falta.
 */
const RESENT = new Set<ClientMessageType>([
  "cell.place",
  "hint.use",
  "note.add",
  "note.remove",
  "note.undo",
  "settings.update",
]);

export interface GameClientOptions {
  readonly transport: Transport;
  /** Reloj del cliente; puede estar desfasado respecto del servidor. */
  readonly now?: () => number;
  /** Preferencias locales (por defecto, localStorage). */
  readonly prefs?: Prefs;
  /** Fichas, apodo y última sala (por defecto, localStorage). */
  readonly session?: SessionStore;
}

/** La entrada pedida que todavía no tiene `room.welcome`. */
type Entry =
  | { readonly kind: "create"; readonly nickname: string }
  | {
      readonly kind: "join";
      readonly code: string;
      readonly nickname: string;
      /** Vuelta con la ficha guardada: si la sala ya no existe o está llena, avisa Inicio. */
      readonly resume: boolean;
    };

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

/** Lo de una partida, vacío: el lobby no tiene tablero, notas ni actividad. */
const NO_MATCH = {
  match: null,
  locked: [],
  groupNotes: new Uint16Array(0),
  personalNotes: new Uint16Array(0),
  pendingNotes: [],
  pending: new Map(),
  flashes: new Map(),
  presence: new Map(),
  activity: [],
  selected: null,
  mode: "number",
  canUndo: false,
  showResults: false,
} as const satisfies Partial<ClientState>;

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
  private startRequest: { difficulty: Difficulty } | null = null;
  /** Mensajes del arranque (`room.create`, `room.set_difficulty` y `match.start`). */
  private readonly startIds = new Set<string>();
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Si la conexión llegó a abrir desde que empezó la entrada actual. */
  private openedSinceEntry = false;
  /** Mensajes del lobby y de Resultados (`match.start` y `room.reset`) sin respuesta. */
  private readonly lobbyIds = new Set<string>();
  private readonly undoStack: UndoGroup[] = [];
  private undoRun: UndoRun | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  /** Último asiento conocido de cada jugador, para su color (docs/diseno.md §2.4). */
  private readonly seats = new Map<string, number>();
  private readonly prefs: Prefs;
  private readonly session: SessionStore;
  private readonly unsubscribeStatus: () => void;
  private entry: Entry | null = null;
  /** `id` del último `room.create` o `room.join` enviado. */
  private entryId: string | null = null;
  /** Si la conexión actual ya recibió su `room.welcome`. */
  private welcomed = false;
  /** Comandos de partida sin respuesta, en orden, por `id` (E-07). */
  private readonly outbox = new Map<string, ClientEnvelope>();
  /**
   * Lo que ya incluye el último snapshot: un mensaje de esa partida con `seq` menor o igual solo
   * resuelve lo pendiente (es la respuesta guardada a un comando reenviado), sin volver a aplicarse.
   */
  private staleBefore: { readonly matchId: string; readonly seq: number } | null = null;
  /** Última señal de vida del servidor (hora del cliente). */
  private lastAlive = 0;
  /** Si la conexión cayó estando en la sala y todavía no se volvió. */
  private reconnecting = false;
  /** Cuenta las comprobaciones de claves escritas: solo vale la respuesta de la última. */
  private accessChecks = 0;

  constructor({
    transport,
    now = () => Date.now(),
    prefs = browserPrefs,
    session = browserSession,
  }: GameClientOptions) {
    this.transport = transport;
    this.now = now;
    this.prefs = prefs;
    this.session = session;
    this.state = {
      ...INITIAL_STATE,
      notesEnabled: prefs.get(USE_NOTES_KEY) !== "0",
      connection: transport.status,
    };
    this.idPrefix = randomId().slice(0, 8);
    this.unsubscribe = transport.subscribe((message) => {
      this.receive(message);
    });
    this.unsubscribeStatus = transport.onStatus((status) => {
      this.onStatus(status);
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
    if (patch.players) {
      for (const player of patch.players)
        if (player.seat !== null) this.seats.set(player.id, player.seat);
    }
    for (const listener of [...this.listeners]) listener();
  }

  /** Hora del servidor estimada. */
  serverNow(): number {
    return this.now() + this.state.clockOffset;
  }

  clientNow(): number {
    return this.now();
  }

  /**
   * Color de un jugador: el de su asiento, `--player-(asiento + 1)`. Sin asiento (salió o expiró),
   * el del último que tuvo.
   */
  colorOf(playerId: string | null): string {
    const seat = playerId === null ? undefined : this.seats.get(playerId);
    return seat === undefined ? "var(--muted)" : `var(--player-${String(seat + 1)})`;
  }

  /** Si se puede intentar entrar a una sala (la conexión se abre al entrar). */
  available(): boolean {
    return true;
  }

  /**
   * Quita el aviso de Inicio (sala llena o borrada). «Volver a la sala» lo llama antes de navegar:
   * con el aviso a la vista, la ruta de esa sala vuelve a Inicio sin intentar (evita el bucle tras el
   * rechazo), y la persona tiene que poder probar otra vez si se liberó un asiento (E-02, T-26.4).
   */
  dismissNotice(): void {
    if (this.state.roomNotice) this.set({ roomNotice: null });
  }

  /** La última sala con ficha guardada, para «Volver a la sala». */
  savedRoom(): string | null {
    const code = this.session.lastRoom();
    return code !== null && this.session.token(code) !== null ? code : null;
  }

  destroy(): void {
    this.unsubscribe();
    this.unsubscribeStatus();
    this.stopPing();
    this.stopStartTimer();
    for (const timer of this.timers) clearTimeout(timer);
    this.transport.close();
  }

  // --- Envío ---

  /** Conectado y dentro de la sala: lo que se envía llega. */
  private live(): boolean {
    return this.transport.status === "open" && this.welcomed;
  }

  private send<T extends ClientMessageType>(type: T, payload: ClientMessage<T>["payload"]): string {
    const id = `${this.idPrefix}-${String(this.nextId++)}`;
    const message = { v: 1, id, type, payload } as ClientMessage;
    if (RESENT.has(type)) {
      // Se guarda hasta su respuesta; si no hay conexión, sale al volver (E-07).
      this.outbox.set(id, message);
      if (this.live()) this.transport.send(message);
    } else {
      this.transport.send(message);
    }
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

  private startPing(): void {
    if (this.pingTimer !== null) return;
    this.ping();
    this.pingTimer = setInterval(() => {
      // Un socket que parece abierto pero ya no recibe nada (por ejemplo, tras suspender el
      // celular): se descarta y se abre otro (ADR 0002).
      if (this.transport.status === "open" && this.now() - this.lastAlive > PONG_TIMEOUT_MS) {
        this.transport.reconnect();
        return;
      }
      this.ping();
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  // --- Conexión y entrada ---

  private onStatus(status: TransportStatus): void {
    if (status !== "open") {
      if (this.welcomed) this.reconnecting = true;
      this.welcomed = false;
      this.stopPing();
    }
    if (status === "denied") {
      // Falta la clave del grupo o no valió (401 o 4003, R-39): se olvida la guardada y se pide otra
      // (T-39.15).
      this.stopStartTimer();
      const hadKey = this.session.accessKey() !== null;
      this.session.saveAccessKey(null);
      this.set({
        connection: status,
        accessDenied: hadKey ? "invalid" : "missing",
        accessCheck: null,
        waking: false,
      });
      return;
    }
    if (status === "locked") {
      // 429 (T-39.10): no es el servidor dormido; hay que esperar.
      this.stopStartTimer();
      this.set({ connection: status, accessDenied: "locked", accessCheck: null, waking: false });
      return;
    }
    this.set({ connection: status });
    if (status === "refused") {
      // 403 en el handshake: tampoco es el servidor dormido. La entrada falla con «Reintentar».
      if (this.state.waking) this.set({ waking: false });
      if (!this.inRoom() && (this.state.phase === "entering" || this.state.phase === "loading"))
        this.failStart();
      return;
    }
    if (status === "open") {
      this.lastAlive = this.now();
      if (!this.openedSinceEntry && this.state.phase === "entering") this.awake();
      this.sendEntry();
      this.startPing();
      return;
    }
    const starting = this.state.phase === "entering" || this.state.phase === "loading";
    // Mientras el servidor despierta, `unavailable` no corta la entrada: el plazo es otro.
    if (status === "unavailable" && starting && !this.inRoom() && this.openedSinceEntry)
      this.failStart();
  }

  /** El apodo de la última entrada en este navegador. */
  savedNickname(): string | null {
    return this.session.nickname();
  }

  /** Si hay ficha guardada para la sala (la ficha nunca sale de la sesión). */
  hasToken(code: string): boolean {
    return this.session.token(code) !== null;
  }

  /** Si ya se entró a la sala (hubo un `room.welcome`), aunque ahora falte la conexión. */
  private inRoom(): boolean {
    return this.state.room !== null && this.state.playerId !== null;
  }

  /** Envía la entrada pendiente o, si ya se estaba en la sala, vuelve con la ficha (R-13). */
  private sendEntry(): void {
    const room = this.state.room;
    if (room && this.inRoom()) {
      const token = this.session.token(room.code);
      const nickname = this.session.nickname() ?? playerName(this.state, this.state.playerId);
      this.entryId = this.send("room.join", {
        code: room.code,
        nickname,
        ...(token === null ? {} : { token }),
      });
      return;
    }
    const entry = this.entry;
    if (!entry) return;
    if (entry.kind === "create") {
      this.entryId = this.send("room.create", { nickname: entry.nickname });
    } else {
      const token = this.session.token(entry.code);
      this.entryId = this.send("room.join", {
        code: entry.code,
        nickname: entry.nickname,
        ...(token === null ? {} : { token }),
      });
    }
    this.startIds.add(this.entryId);
  }

  /** Empieza una entrada: abre la conexión y, cuando abre, envía `room.create` o `room.join`. */
  private enter(entry: Entry): void {
    this.set({
      ...INITIAL_STATE,
      phase: "entering",
      notesEnabled: this.state.notesEnabled,
      connection: this.transport.status,
      lastStart: this.state.lastStart,
      lastEntry: {
        kind: entry.kind,
        nickname: entry.nickname,
        code: entry.kind === "join" ? entry.code : null,
        resume: entry.kind === "join" && entry.resume,
      },
    });
    this.resetRoomSession();
    this.entry = entry;
    this.session.saveNickname(entry.nickname);
    this.stopStartTimer();
    this.openedSinceEntry = this.transport.status === "open";
    // Sin conexión abierta, puede que el servidor esté dormido: más plazo y, a los 3 s, el aviso.
    this.armStartTimer(this.openedSinceEntry ? START_TIMEOUT_MS : WAKE_TIMEOUT_MS);
    if (!this.openedSinceEntry) {
      this.wakeTimer = setTimeout(() => {
        this.wakeTimer = null;
        if (this.state.phase === "entering" && !this.openedSinceEntry) this.set({ waking: true });
      }, WAKE_NOTICE_MS);
    }
    if (this.transport.status === "open") {
      this.lastAlive = this.now();
      this.sendEntry();
      this.startPing();
    } else {
      this.transport.connect();
    }
  }

  /** Crea una sala nueva (R-09). */
  create(nickname: string): void {
    this.enter({ kind: "create", nickname });
  }

  /** Entra a una sala con su código; si hay ficha guardada para ella, vuelve con la ficha. */
  join(code: string, nickname: string): void {
    this.enter({ kind: "join", code: code.toUpperCase(), nickname, resume: false });
  }

  /** Vuelve a la sala de la ficha guardada (R-13, R-26). */
  resume(code: string): void {
    this.enter({
      kind: "join",
      code: code.toUpperCase(),
      nickname: this.session.nickname() ?? "",
      resume: true,
    });
  }

  /** «Reintentar» de Entrar: repite la última entrada con los mismos datos (T-37.1). */
  retryEntry(): void {
    const last = this.state.lastEntry;
    if (!last) return;
    if (last.kind === "create") this.create(last.nickname);
    else if (last.code !== null)
      this.enter({ kind: "join", code: last.code, nickname: last.nickname, resume: last.resume });
  }

  /**
   * La clave escrita en «Clave del grupo» (R-39, T-39.14): se comprueba con `POST /access` y, solo
   * si vale (204), se guarda en este dispositivo y se repite lo que se estaba haciendo (volver a la
   * sala o la última entrada). Devuelve `false` si no tiene el largo de una clave.
   */
  submitAccessKey(raw: string): boolean {
    const key = normalizeAccessKey(raw);
    if (!isValidAccessKey(key)) return false;
    void this.verifyKey(key);
    return true;
  }

  /**
   * La clave de un enlace de invitación (`#k=`, T-39.14): pasa por la misma comprobación, en
   * «Clave del grupo», y solo se guarda si vale.
   */
  acceptInvitation(key: string): void {
    this.set({ accessDenied: "missing" });
    void this.verifyKey(key);
  }

  /**
   * Pregunta `POST /access` por la clave. Sin respuesta (el servidor puede estar despertando), se
   * vuelve a preguntar hasta `WAKE_TIMEOUT_MS`. Sin `checkAccess` (el servidor simulado), vale.
   */
  private async verifyKey(key: string): Promise<void> {
    const asked = ++this.accessChecks;
    const current = () => asked === this.accessChecks && this.state.accessDenied !== null;
    this.set({ accessCheck: "checking" });
    const check = this.transport.checkAccess?.bind(this.transport);
    const deadline = this.now() + WAKE_TIMEOUT_MS;
    let answer = check ? await check(key) : 204;
    while (answer === null && current() && this.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, ACCESS_RETRY_MS));
      if (!current()) return;
      answer = check ? await check(key) : 204;
    }
    if (!current()) return;
    // 404: un servidor sin `POST /access`; el handshake decide (4003, el respaldo).
    if (answer === 204 || answer === 404) {
      this.session.saveAccessKey(key);
      this.set({ accessCheck: null });
      this.retryAccess();
    } else if (answer === 401) {
      this.set({ accessCheck: "wrong" });
    } else if (answer === 429) {
      this.set({ accessDenied: "locked", accessCheck: null });
    } else {
      this.set({ accessCheck: "unreachable" });
    }
  }

  /** «Reintentar» tras la espera del bloqueo (429): con la clave guardada, sin escribirla otra vez. */
  retryAccess(): void {
    this.accessChecks++;
    this.set({ accessDenied: null, accessCheck: null });
    if (this.inRoom()) this.transport.reconnect();
    else if (this.state.lastEntry) this.retryEntry();
    else this.backHome();
  }

  /** «Volver al inicio» desde «Clave del grupo». */
  cancelAccess(): void {
    this.accessChecks++;
    this.backHome();
  }

  /** «Jugar en esta pestaña» (E-08): vuelve con la ficha y desplaza a la otra pestaña. */
  playHere(): void {
    if (this.inRoom()) this.transport.reconnect();
  }

  /** Olvida lo propio de la sala: entrada, pendientes y deshacer. */
  private resetRoomSession(): void {
    this.entry = null;
    this.entryId = null;
    this.welcomed = false;
    this.reconnecting = false;
    this.outbox.clear();
    this.staleBefore = null;
    this.startIds.clear();
    this.lobbyIds.clear();
    this.undoStack.length = 0;
    this.undoRun = null;
  }

  // --- Acciones de la interfaz ---

  /**
   * Arranque directo (el inicio mínimo que usan las pruebas): crea la sala, elige la
   * dificultad e inicia la partida, sin pasar por el lobby.
   */
  start(nickname: string, difficulty: Difficulty): void {
    this.set({ lastStart: { nickname, difficulty } });
    this.create(nickname);
    this.startRequest = { difficulty };
  }

  /**
   * Sale de la sala a propósito (R-26). La ficha se conserva: si vuelve a la misma partida y hay
   * cupo, recupera vidas, puntos y notas (D3).
   */
  leave(): void {
    if (this.live()) this.send("room.leave", {});
    this.backHome();
  }

  /**
   * La entrada o la carga fallaron, o no terminaron a tiempo: se sale de la sala (si se llegó a
   * entrar) y el inicio muestra el aviso con «Reintentar», con el apodo y la dificultad (T-37.1).
   */
  private failStart(): void {
    this.stopStartTimer();
    this.startRequest = null;
    this.startIds.clear();
    if (this.state.room && this.live()) this.send("room.leave", {});
    this.backHome();
    this.set({ startFailed: true });
  }

  private stopStartTimer(): void {
    if (this.startTimer !== null) clearTimeout(this.startTimer);
    this.startTimer = null;
    if (this.wakeTimer !== null) clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
  }

  private armStartTimer(ms: number): void {
    if (this.startTimer !== null) clearTimeout(this.startTimer);
    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      if (this.state.phase === "entering" || this.state.phase === "loading") this.failStart();
    }, ms);
  }

  /** La conexión abrió por primera vez en esta entrada: el servidor está despierto. */
  private awake(): void {
    this.openedSinceEntry = true;
    if (this.wakeTimer !== null) clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    this.armStartTimer(START_TIMEOUT_MS);
    if (this.state.waking) this.set({ waking: false });
  }

  backHome(): void {
    this.stopStartTimer();
    this.startRequest = null;
    this.resetRoomSession();
    this.transport.disconnect();
    this.set({
      ...INITIAL_STATE,
      settings: this.state.settings,
      notesEnabled: this.state.notesEnabled,
      lastStart: this.state.lastStart,
      lastEntry: this.state.lastEntry,
      connection: this.transport.status,
    });
  }

  // --- Lobby y resultados ---

  /** Quien inicia elige la dificultad; los demás la ven al momento (R-11). */
  setDifficulty(difficulty: Difficulty): void {
    const room = this.state.room;
    if (!room || this.state.phase !== "lobby" || room.starterId !== this.state.playerId) return;
    if (!this.live()) return;
    this.set({ room: { ...room, difficulty } });
    this.send("room.set_difficulty", { difficulty });
  }

  /** «Iniciar partida» (R-11). Queda en espera hasta `match.started` o un error. */
  startMatch(): void {
    const room = this.state.room;
    if (!room || this.state.phase !== "lobby" || this.state.starting) return;
    if (room.starterId !== this.state.playerId || !this.live()) return;
    this.lobbyIds.add(this.send("match.start", {}));
    this.set({ starting: true });
  }

  /** «Ver resultados» (decisión de diseño: el paso a Resultados nunca es automático). */
  viewResults(): void {
    if (this.state.phase === "ended") this.set({ showResults: true });
  }

  /** «Volver al lobby» de quien inicia: la sala vuelve a `waiting` para todos (T-22.1). */
  returnToLobby(): void {
    const room = this.state.room;
    if (!room || this.state.phase !== "ended" || room.starterId !== this.state.playerId) return;
    if (!this.live()) return;
    this.lobbyIds.add(this.send("room.reset", {}));
  }

  /** La sala volvió a `waiting`: se borra lo de la partida (SPEC §3.1) y se pasa al lobby. */
  private toLobby(): void {
    const room = this.state.room;
    if (!room) return;
    const starter = room.starterId;
    this.undoStack.length = 0;
    this.undoRun = null;
    this.staleBefore = null;
    this.set({
      phase: "lobby",
      room: { ...room, state: "waiting" },
      players: this.state.players.map((p) => ({
        ...p,
        role: null,
        lives: NORMAL_RULES.initialLives,
        score: 0,
        mistakes: 0,
      })),
      ...NO_MATCH,
      toasts: [],
      starting: false,
      lobbyNotice:
        starter !== null && starter !== this.state.playerId
          ? { kind: "reset", by: playerName(this.state, starter) }
          : null,
    });
  }

  select(cell: number | null): void {
    if (this.state.selected === cell) return;
    this.set({ selected: cell });
    if (this.state.phase === "playing" && this.live()) this.send("presence.select", { cell });
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
    if (!this.state.notesEnabled) return;
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
    if (!this.state.notesEnabled) return;
    this.set({ layer: this.state.layer === "personal" ? "group" : "personal" });
  }

  toggleVisible(layer: NoteLayer): void {
    this.set({ visible: { ...this.state.visible, [layer]: !this.state.visible[layer] } });
  }

  dismissToast(id: number): void {
    this.set({ toasts: this.state.toasts.filter((toast) => toast.id !== id) });
  }

  /** «Usar notas» (preferencia local, sin protocolo): sin notas, el modo queda en Número. */
  setNotesEnabled(notesEnabled: boolean): void {
    this.prefs.set(USE_NOTES_KEY, notesEnabled ? "1" : "0");
    this.set(notesEnabled ? { notesEnabled } : { notesEnabled, mode: "number" });
  }

  setAutoClean(autoCleanPersonalNotes: boolean): void {
    this.set({ settings: { autoCleanPersonalNotes } });
    this.send("settings.update", { autoCleanPersonalNotes });
  }

  /** Si el jugador puede colocar números ahora (activo, conectado y con la partida en curso). */
  canPlace(): boolean {
    const role = me(this.state)?.role;
    return (
      this.state.phase === "playing" &&
      this.state.connection === "open" &&
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
    if ((this.state.mode === "number" || !this.state.notesEnabled) && this.canPlace()) {
      const id = this.send("cell.place", { cell, digit });
      const pending = new Map(this.state.pending).set(cell, { id, digit });
      this.set({ pending });
      return;
    }
    if (this.state.notesEnabled && (this.state.mode === "notes" || !this.canPlace())) {
      const layer = this.state.layer;
      const present = ((viewNotes(this.state, layer)[cell] ?? 0) & digitBit(digit)) !== 0;
      this.noteOps([{ layer, op: present ? "remove" : "add", cell, digit }]);
    }
  }

  /** «Borrar»: quita las notas de la capa activa en la celda (un grupo de deshacer, decisión 5). */
  clearNotes(): void {
    const cell = this.editableCell();
    if (cell === null || !this.state.notesEnabled) return;
    const layer = this.state.layer;
    const mask = viewNotes(this.state, layer)[cell] ?? 0;
    const ops: Omit<PendingNote, "id">[] = [];
    for (let digit = 1; digit <= (this.state.match?.puzzle.size ?? 9); digit++) {
      if (mask & digitBit(digit)) ops.push({ layer, op: "remove", cell, digit });
    }
    if (ops.length > 0) this.noteOps(ops);
  }

  private noteOps(ops: readonly Omit<PendingNote, "id">[]): void {
    // Sin servidor no se encola nada: no se registraría (docs/diseno.md §9).
    if (this.state.connection === "unavailable") return;
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
    if (this.undoRun || this.state.connection === "unavailable") return;
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

  /** Un aviso breve; su texto también queda en el historial de actividad (decisión 4). */
  private toast(role: Toast["role"], text: string): void {
    this.set({ toasts: [...this.state.toasts, { id: this.nextKey++, role, text }] });
    this.log("notice", this.state.playerId ?? "", null, text);
  }

  private log(kind: ActivityKind, playerId: string, cell: number | null, text?: string): void {
    const startedAt = this.state.match?.startedAt ?? this.serverNow();
    const entry = {
      key: this.nextKey++,
      kind,
      playerId,
      cell,
      elapsed: Math.max(0, this.serverNow() - startedAt),
      ...(text === undefined ? {} : { text }),
    };
    this.set({ activity: [...this.state.activity, entry] });
  }

  private cellName(cell: number): string {
    return cellName(cell, this.state.match?.puzzle.size ?? 9);
  }

  // --- Mensajes del servidor ---

  private receive(message: ServerEnvelope): void {
    this.lastAlive = this.now();
    const mine = message.replyTo !== undefined;
    if (message.replyTo !== undefined) {
      this.outbox.delete(message.replyTo);
      if (message.type !== "error") this.lobbyIds.delete(message.replyTo);
    }
    // Antes del `room.welcome` de esta conexión no llegan eventos (el servidor solo difunde a quien
    // ya lo recibió); si llegara uno, el snapshot que viene ya lo incluye.
    if (!this.welcomed && message.seq !== undefined) return;
    if (this.isStale(message)) {
      this.resolveStale(message);
      return;
    }
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
      case "room.starter_changed": {
        const room = this.state.room;
        if (!room) return;
        const from = room.starterId;
        const to = message.payload.playerId;
        this.set({ room: { ...room, starterId: to } });
        // El aviso de traspaso del lobby (design/pantallas.md §1.3).
        if (this.state.phase === "lobby" && from !== null && to !== null && from !== to) {
          this.set({
            lobbyNotice: { kind: "starter", from: playerName(this.state, from), to },
          });
        }
        return;
      }
      case "room.difficulty_set":
        if (this.state.room)
          this.set({ room: { ...this.state.room, difficulty: message.payload.difficulty } });
        return;
      case "room.state_changed":
        if (
          message.payload.state === "waiting" &&
          (this.state.room?.state === "finished" || this.state.phase === "ended")
        ) {
          this.toLobby();
          return;
        }
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
    const { playerId, token, snapshot } = message.payload;
    const { room, match, you } = snapshot;
    if (message.replyTo !== this.entryId) return;
    if (token !== undefined) this.session.saveToken(room.code, token);
    this.session.saveLastRoom(room.code);
    const returning = this.reconnecting && this.state.playerId === playerId;
    // R-38: el snapshot no trae el historial. Si la partida en curso ya tuvo jugadas, la actividad
    // empieza con un aviso en lugar de «Todavía no hay jugadas».
    const earlierPlays =
      match?.endedAt === null &&
      (match.locked.some((cell) => cell.source !== "given") ||
        room.players.some((p) => p.mistakes > 0));
    if (this.state.playerId !== null && this.state.playerId !== playerId) {
      // La ficha ya no valía: es otra entrada, sin nada pendiente de la anterior.
      const entryId = this.entryId;
      this.resetRoomSession();
      this.entryId = entryId;
    }
    this.entry = null;
    this.welcomed = true;
    this.reconnecting = false;
    this.staleBefore = match ? { matchId: match.id, seq: snapshot.atSeq ?? 0 } : null;
    this.setOffsetFromSnapshot(snapshot.serverNow);
    this.set({
      roomNotice: null,
      playerId,
      room: {
        code: room.code,
        state: room.state,
        starterId: room.starterId,
        difficulty: room.difficulty,
      },
      players: room.players,
      settings: you.settings,
      phase: match
        ? match.endedAt === null
          ? "playing"
          : "ended"
        : this.startRequest
          ? "loading"
          : "lobby",
      starting: false,
      // Volver a una sala con la partida terminada lleva a Resultados (decisión 3); tras un corte en
      // la misma sesión, se queda donde estaba.
      showResults: (match?.endedAt ?? null) !== null && (returning ? this.state.showResults : true),
      ...(match ? {} : NO_MATCH),
      ...(earlierPlays ? { activity: [] } : {}),
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
    if (match || !this.startRequest) this.stopStartTimer();
    // Lo que quedó sin respuesta sale otra vez, con el mismo `id` (E-07).
    let queued = 0;
    for (const pending of this.outbox.values()) {
      this.transport.send(pending);
      if (pending.type.startsWith("note.")) queued++;
    }
    // Llegada directa a una partida en curso (R-12): se entra con 3 vidas.
    if (match?.endedAt === null && !returning && you.personalNotes.length === 0) {
      const self = room.players.find((p) => p.id === playerId);
      if (self?.role === "active" && self.lives === NORMAL_RULES.initialLives && self.score === 0)
        this.toast("status", t("state.joinedRunning"));
    }
    if (returning) {
      this.toast(
        "status",
        queued > 0 ? t("state.reconnectedQueued", { count: queued }) : t("state.reconnected"),
      );
    }
    // Después de los avisos de la vuelta, para que la línea lo muestre hasta la próxima jugada.
    if (earlierPlays) this.log("notice", playerId, null, t("activity.gap"));
    const request = this.startRequest;
    if (request && !match) {
      this.startRequest = null;
      this.startIds.add(this.send("room.set_difficulty", { difficulty: request.difficulty }));
      this.startIds.add(this.send("match.start", {}));
    }
  }

  /** Si el mensaje ya está incluido en el último snapshot (ver `staleBefore`). */
  private isStale(message: ServerEnvelope): boolean {
    const before = this.staleBefore;
    if (!before || message.seq === undefined) return false;
    if (message.type === "match.started") return message.payload.matchId === before.matchId;
    return this.state.match?.id === before.matchId && message.seq <= before.seq;
  }

  /** La respuesta guardada a un comando reenviado: solo se resuelve lo pendiente. */
  private resolveStale(message: ServerEnvelope): void {
    const id = message.replyTo;
    if (id === undefined) return;
    const placement = [...this.state.pending].find(([, p]) => p.id === id);
    if (placement) {
      const pending = new Map(this.state.pending);
      pending.delete(placement[0]);
      this.set({ pending });
    }
    if (message.type === "note.applied") {
      const { opSeq, layer, cell, undoOf } = message.payload;
      this.set({ pendingNotes: withoutPending(this.state.pendingNotes, id) });
      this.noteResolved(id, opSeq, layer, cell, undoOf);
    }
  }

  private onMatchStarted(payload: ServerMessage<"match.started">["payload"]): void {
    const { puzzle } = payload;
    const cells = puzzle.size * puzzle.size;
    const locked: ClientState["locked"][number][] = new Array<null>(cells).fill(null);
    for (const { cell, value } of puzzle.givens)
      locked[cell] = { value, source: "given", by: null };
    this.undoStack.length = 0;
    this.stopStartTimer();
    this.startIds.clear();
    this.staleBefore = null;
    this.lobbyIds.clear();
    this.set({
      phase: "playing",
      starting: false,
      lobbyNotice: null,
      showResults: false,
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
    const patch: { -readonly [K in keyof ClientState]?: ClientState[K] } =
      layer === "group"
        ? { groupNotes: applyNoteOp(this.state.groupNotes, op, cell, digit) }
        : { personalNotes: applyNoteOp(this.state.personalNotes, op, cell, digit) };
    const replyTo = message.replyTo;
    if (replyTo !== undefined)
      patch.pendingNotes = withoutPending(this.state.pendingNotes, replyTo);
    this.set(patch);
    if (replyTo !== undefined) this.noteResolved(replyTo, opSeq, layer, cell, undoOf);
  }

  /** Una nota propia confirmada: entra en su grupo de deshacer o cierra un deshacer. */
  private noteResolved(
    id: string,
    opSeq: number,
    layer: NoteLayer,
    cell: number,
    undoOf: number | undefined,
  ): void {
    if (undoOf !== undefined) {
      this.undoResult(id, true);
      return;
    }
    const group = this.undoStack.find((g) => g.waiting.has(id));
    if (!group) return;
    group.waiting.delete(id);
    group.opSeqs.push(opSeq);
    group.cells.set(opSeq, { layer, cell });
  }

  private onAck(message: ServerMessage<"ack">): void {
    const replyTo = message.replyTo;
    if (replyTo === undefined) return;
    // Una nota sin efecto: se quita de las pendientes y de su grupo de deshacer.
    if (this.state.pendingNotes.some((op) => op.id === replyTo)) {
      this.set({ pendingNotes: withoutPending(this.state.pendingNotes, replyTo) });
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
    if (replyTo !== undefined && replyTo === this.entryId && this.inRoom()) {
      this.onRejoinError(code);
      return;
    }
    const starting = this.state.phase === "entering" || this.state.phase === "loading";
    if (
      starting &&
      replyTo === this.entryId &&
      (code === "nickname.invalid" ||
        code === "nickname.taken" ||
        code === "room.not_found" ||
        code === "room.full")
    ) {
      const entry = this.entry;
      if (code === "room.not_found" && entry?.kind === "join") {
        this.session.forgetToken(entry.code);
        if (this.session.lastRoom() === entry.code) this.session.saveLastRoom(null);
      }
      this.stopStartTimer();
      this.resetRoomSession();
      this.transport.disconnect();
      // Volver con la ficha a una sala borrada o llena se avisa en Inicio (design/pantallas.md §1.1).
      if (
        entry?.kind === "join" &&
        entry.resume &&
        (code === "room.not_found" || code === "room.full")
      ) {
        this.set({
          phase: "home",
          roomNotice: { kind: code === "room.full" ? "full" : "gone", code: entry.code },
        });
        return;
      }
      this.set({ phase: "home", enterError: code });
      return;
    }
    // Cualquier otro error del arranque (o del servidor, sin `replyTo`) lo hace fallar.
    if (starting && (replyTo === undefined || this.startIds.has(replyTo))) {
      this.failStart();
      return;
    }
    if (replyTo === undefined) return;
    if (this.lobbyIds.delete(replyTo)) {
      this.set({ starting: false });
      if (code === "rate_limited") this.toast("status", t("state.rateLimited"));
      else this.toast("alert", t("state.error", { code }));
      return;
    }
    if (this.undoRun?.awaiting.has(replyTo)) {
      this.undoResult(replyTo, false);
      return;
    }
    if (this.state.pendingNotes.some((op) => op.id === replyTo)) {
      this.set({ pendingNotes: withoutPending(this.state.pendingNotes, replyTo) });
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

  /** La vuelta con ficha falló: la sala ya no existe, está llena o se está reconstruyendo. */
  private onRejoinError(code: string): void {
    const room = this.state.room;
    if (!room) return;
    if (code === "room.not_found" || code === "room.full") {
      if (code === "room.not_found") {
        this.session.forgetToken(room.code);
        this.session.saveLastRoom(null);
      }
      this.backHome();
      this.set({ roomNotice: { kind: code === "room.full" ? "full" : "gone", code: room.code } });
      return;
    }
    // `server.unavailable` (E-16) u otro: se vuelve a intentar con una conexión nueva.
    this.later(() => {
      if (this.inRoom() && !this.welcomed) this.transport.reconnect();
    }, REJOIN_RETRY_MS);
  }

  private onEnded(payload: ServerMessage<"match.ended">["payload"]): void {
    const match = this.state.match;
    if (!match) return;
    this.set({
      phase: "ended",
      room: this.state.room ? { ...this.state.room, state: "finished" } : null,
      match: {
        ...match,
        endedAt: payload.endedAt,
        result: payload.result,
        ...(payload.defeatCause === undefined ? {} : { defeatCause: payload.defeatCause }),
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
