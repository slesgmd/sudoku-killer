// Bot compañero (F8f, solo desarrollo): otro jugador que entra a la sala simulada y juega por el
// mismo protocolo v1, para ver jugadas, errores y presencia de otros. No ve la solución: deduce
// cada dígito con `levelsToDeduce` sobre lo público (números colocados y descartes de los errores),
// prefiere las celdas más fáciles y, a veces, se equivoca a propósito. El azar sale de un `Rng`
// con semilla y el tiempo, de un planificador inyectado.
import { createRng, levelsToDeduce, singleDigit, type Rng } from "@sudoku-killer/engine";
import type {
  ClientMessage,
  ClientMessageType,
  PublicPuzzle,
  ServerEnvelope,
} from "@sudoku-killer/protocol";
import type { Transport } from "../../transport/types.ts";

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realScheduler: Scheduler = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export interface BotOptions {
  readonly transport: Transport;
  readonly code: string;
  readonly nickname: string;
  readonly seed: number;
  /** Tiempo medio entre jugadas, en milisegundos. */
  readonly paceMs: number;
  /** Probabilidad de equivocarse a propósito en cada jugada, de 0 a 1. */
  readonly errorRate: number;
  readonly scheduler?: Scheduler;
  /** Avisos para quien lo lanzó (entró, no pudo entrar, terminó). Nunca incluyen la ficha. */
  readonly onNotice?: (text: string) => void;
}

/** Intentos con otro apodo si el pedido ya está en uso («Tomás 2», «Tomás 3», …). */
const NICKNAME_ATTEMPTS = 5;

/** Lo que el bot sabe de la partida: solo lo que llega por el protocolo. */
export interface BotBoard {
  readonly puzzle: PublicPuzzle;
  readonly values: number[];
  readonly excluded: { cell: number; digit: number }[];
}

/** Una jugada: dónde, qué dígito y si es un error a propósito. */
export interface BotMove {
  readonly cell: number;
  readonly digit: number;
  readonly mistake: boolean;
}

/**
 * Elige la próxima jugada: una de las celdas de menor nivel, al azar, con el único candidato que le
 * queda en el punto fijo de su nivel. Con probabilidad `errorRate`, otro dígito. Determinista para
 * el mismo `rng` y el mismo tablero.
 */
export function chooseMove(board: BotBoard, rng: Rng, errorRate: number): BotMove | null {
  const { levels, fixpoints } = levelsToDeduce({
    puzzle: board.puzzle,
    values: board.values,
    excluded: board.excluded,
  });
  let best = Number.POSITIVE_INFINITY;
  let cells: number[] = [];
  levels.forEach((level, cell) => {
    if (board.values[cell] !== 0 || level <= 0) return;
    if (level < best) {
      best = level;
      cells = [cell];
    } else if (level === best) cells.push(cell);
  });
  const cell = cells[rng.int(Math.max(1, cells.length))];
  if (cell === undefined) return null;
  const digit = singleDigit(fixpoints[best]?.[cell] ?? 0);
  if (digit === 0) return null;
  // Error a propósito con probabilidad `errorRate` (en milésimas).
  if (rng.int(1000) < errorRate * 1000) {
    const others = Array.from({ length: board.puzzle.size }, (_, i) => i + 1).filter(
      (d) => d !== digit && !board.excluded.some((e) => e.cell === cell && e.digit === d),
    );
    const wrong = others[rng.int(Math.max(1, others.length))];
    if (wrong !== undefined) return { cell, digit: wrong, mistake: true };
  }
  return { cell, digit, mistake: false };
}

export class Bot {
  private readonly options: BotOptions;
  private readonly rng: Rng;
  private readonly scheduler: Scheduler;
  private readonly unsubscribe: () => void;
  private board: BotBoard | null = null;
  private playerId: string | null = null;
  private active = true;
  private stopped = false;
  private timer: unknown = null;
  private nextId = 1;
  /** La ficha de la sala, para volver si la conexión cae (solo en memoria). */
  private token: string | null = null;
  private readonly unsubscribeStatus: () => void;
  private nickname: string;
  private nicknameAttempts = 0;

  constructor(options: BotOptions) {
    this.options = options;
    this.nickname = options.nickname;
    this.rng = createRng(options.seed >>> 0);
    this.scheduler = options.scheduler ?? realScheduler;
    this.unsubscribe = options.transport.subscribe((message) => {
      this.receive(message);
    });
    // Entra (o vuelve con su ficha) cada vez que la conexión abre.
    this.unsubscribeStatus = options.transport.onStatus((status) => {
      if (status === "open") this.join();
    });
    if (options.transport.status === "open") this.join();
    else options.transport.connect();
  }

  private join(): void {
    this.send("room.join", {
      code: this.options.code,
      nickname: this.nickname,
      ...(this.token === null ? {} : { token: this.token }),
    });
  }

  stop(): void {
    this.stopped = true;
    this.active = false;
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.unsubscribe();
    this.unsubscribeStatus();
    this.options.transport.close();
  }

  private send<T extends ClientMessageType>(type: T, payload: ClientMessage<T>["payload"]): void {
    const id = `bot-${String(this.options.seed)}-${String(this.nextId++)}`;
    this.options.transport.send({ v: 1, id, type, payload } as ClientMessage);
  }

  /** El ritmo varía entre la mitad y una vez y media de `paceMs`. */
  private wait(): number {
    const pace = Math.max(1, this.options.paceMs);
    return Math.round(pace / 2 + this.rng.int(Math.max(1, Math.round(pace))));
  }

  private schedule(): void {
    if (!this.active || this.timer !== null || !this.board) return;
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      this.play();
    }, this.wait());
  }

  /** Mira la celda (presencia), anota a veces un candidato grupal y coloca el dígito. */
  private play(): void {
    const board = this.board;
    if (!this.active || !board) return;
    const move = chooseMove(board, this.rng, this.options.errorRate);
    if (!move) return;
    this.send("presence.select", { cell: move.cell });
    if (this.rng.int(5) === 0) {
      this.send("note.add", { layer: "group", cell: move.cell, digit: move.digit });
    }
    const pause = Math.round(Math.max(1, this.options.paceMs) / 3);
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      if (!this.active || this.board !== board || board.values[move.cell] !== 0) {
        this.schedule();
        return;
      }
      this.send("cell.place", { cell: move.cell, digit: move.digit });
      this.schedule();
    }, pause);
  }

  private receive(message: ServerEnvelope): void {
    switch (message.type) {
      case "room.welcome": {
        if (this.playerId === null) this.options.onNotice?.(`${this.nickname} entró a la sala.`);
        this.playerId = message.payload.playerId;
        this.token = message.payload.token ?? this.token;
        const match = message.payload.snapshot.match;
        if (match?.endedAt === null) {
          const size = match.puzzle.size;
          const values = new Array<number>(size * size).fill(0);
          for (const { cell, value } of match.locked) values[cell] = value;
          this.board = { puzzle: match.puzzle, values, excluded: [] };
          this.schedule();
        }
        return;
      }
      case "match.started": {
        const { puzzle } = message.payload;
        const values = new Array<number>(puzzle.size * puzzle.size).fill(0);
        for (const { cell, value } of puzzle.givens) values[cell] = value;
        this.board = { puzzle, values, excluded: [] };
        // Cada partida empieza con todos activos (P4).
        this.active = !this.stopped;
        this.schedule();
        return;
      }
      case "cell.solved":
      case "hint.used":
        if (this.board) this.board.values[message.payload.cell] = message.payload.value;
        return;
      case "cell.mistake": {
        const { cell, digit, by, role } = message.payload;
        const known = this.board?.excluded.some((e) => e.cell === cell && e.digit === digit);
        if (this.board && !known) this.board.excluded.push({ cell, digit });
        // Sin vidas, el bot deja de jugar (un espectador solo escribe notas).
        if (by === this.playerId && role === "spectator") this.active = false;
        return;
      }
      case "match.ended":
        this.active = false;
        this.options.onNotice?.(
          `${this.nickname}: la partida terminó (${message.payload.result}).`,
        );
        return;
      case "error": {
        const { code } = message.payload;
        if (this.playerId !== null) return;
        if (code === "nickname.taken" && this.nicknameAttempts < NICKNAME_ATTEMPTS) {
          this.nicknameAttempts++;
          this.nickname = `${this.options.nickname} ${String(this.nicknameAttempts + 1)}`;
          this.join();
          return;
        }
        this.options.onNotice?.(`${this.nickname} no pudo entrar: ${code}.`);
        this.stop();
        return;
      }
      default:
        return;
    }
  }
}
