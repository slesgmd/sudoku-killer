// T-16.2 (R-16, ADR 0005, SPEC §8.4): con operaciones concurrentes de notas grupales de varios
// clientes, entregas en un orden cualquiera (FIFO por conexión, como TCP) y cortes de conexión en
// medio, todos convergen al estado que define el orden del servidor.
// Los clientes son `GameClient` reales; el servidor es un modelo mínimo del de F9: ordena las
// operaciones con `seq`, responde `ack{applied:false}` a las que no cambian nada, guarda la respuesta
// de cada `id` (idempotencia, E-07) y, al volver, envía un snapshot con `atSeq`.
// En cada paso, lo confirmado de cada cliente es el estado del servidor en el último `seq` que le
// llegó; al final, lo que ve cada cliente es el estado del servidor y no queda nada pendiente.
import type {
  ClientEnvelope,
  PublicPlayer,
  PublicPuzzle,
  ServerEnvelope,
} from "@sudoku-killer/protocol";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assertProperty, seedMessage } from "../../../packages/engine/test/helpers/property.ts";
import { GameClient } from "../src/game/client.ts";
import { applyNoteOp } from "../src/game/notes.ts";
import { memoryPrefs } from "../src/game/prefs.ts";
import { memorySession } from "../src/game/session.ts";
import { viewNotes } from "../src/game/state.ts";
import { Listeners, type Transport, type TransportStatus } from "../src/transport/types.ts";

const CODE = "HPQ6NZ";
const CLIENTS = 3;
/** Pocas celdas y dígitos, para que las operaciones choquen seguido. */
const CELLS = 3;
const DIGITS = 3;

/** Lo que ejercitaron todas las ejecuciones, para comprobar que la propiedad no pasa en vacío. */
const coverage = { applied: 0, ignored: 0, duplicates: 0, returns: 0 };

function puzzle(): PublicPuzzle {
  const cages: { id: number; cells: number[]; sum: number }[] = [];
  for (let cell = 0; cell < 81; cell += 3) {
    cages.push({ id: cages.length, cells: [cell, cell + 1, cell + 2], sum: 6 });
  }
  return { id: "p", size: 9, boxRows: 3, boxCols: 3, difficulty: "easy", cages, givens: [] };
}

function player(index: number): PublicPlayer {
  return {
    id: `p${String(index)}`,
    nickname: `Jugador ${String(index)}`,
    seat: index,
    joinedAt: index,
    connection: "connected",
    role: "active",
    lives: 3,
    score: 0,
    mistakes: 0,
  };
}

class LinkTransport implements Transport {
  status: TransportStatus = "idle";
  up: ClientEnvelope[] = [];
  down: ServerEnvelope[] = [];
  /** Si ya entró alguna vez (las entradas siguientes son vueltas con la ficha). */
  joined = false;
  private readonly messages = new Listeners<ServerEnvelope>();
  private readonly statuses = new Listeners<TransportStatus>();
  private readonly server: ModelServer;
  private readonly index: number;

  constructor(server: ModelServer, index: number) {
    this.server = server;
    this.index = index;
  }

  send(message: ClientEnvelope): void {
    if (this.status === "open") this.up.push(message);
  }

  subscribe(listener: (message: ServerEnvelope) => void): () => void {
    return this.messages.add(listener);
  }

  onStatus(listener: (status: TransportStatus) => void): () => void {
    return this.statuses.add(listener);
  }

  private setStatus(status: TransportStatus): void {
    this.status = status;
    this.statuses.emit(status);
  }

  connect(): void {
    if (this.status !== "open") this.open();
  }

  reconnect(): void {
    this.drop();
    this.open();
  }

  disconnect(): void {
    this.drop();
    this.setStatus("idle");
  }

  close(): void {
    this.disconnect();
  }

  open(): void {
    this.server.connected.add(this.index);
    this.setStatus("open");
  }

  /** La conexión se corta: lo que estaba en vuelo se pierde. */
  drop(): void {
    this.up = [];
    this.down = [];
    this.server.connected.delete(this.index);
    this.server.ready.delete(this.index);
    if (this.status === "open") this.setStatus("reconnecting");
  }

  deliverDown(): ServerEnvelope | undefined {
    const message = this.down.shift();
    if (message) this.messages.emit(message);
    return message;
  }
}

class ModelServer {
  notes: Uint16Array = new Uint16Array(81);
  seq = 0;
  /** El estado de las notas grupales después de cada `seq`. */
  readonly history: Uint16Array[] = [this.notes.slice()];
  /** Conexiones abiertas. */
  readonly connected = new Set<number>();
  /**
   * Conexiones que ya recibieron su `room.welcome`: solo a ellas se difunde, como en el servidor
   * real (los miembros `ready`).
   */
  readonly ready = new Set<number>();
  readonly links: LinkTransport[] = [];
  private readonly replies = new Map<string, ServerEnvelope[]>();

  /** Una respuesta al autor, por su conexión. */
  private to(index: number, envelope: ServerEnvelope): void {
    if (this.connected.has(index)) this.links[index]?.down.push(envelope);
  }

  handle(index: number, message: ClientEnvelope): void {
    const me = player(index);
    const key = `${String(index)}:${message.id}`;
    const cached = this.replies.get(key);
    if (cached) {
      coverage.duplicates++;
      for (const envelope of cached) this.to(index, envelope);
      return;
    }
    switch (message.type) {
      case "room.join": {
        if (this.links[index]?.joined === true) coverage.returns++;
        const link = this.links[index];
        if (link) link.joined = true;
        const groupNotes = [...this.notes].flatMap((mask, cell) => (mask ? [{ cell, mask }] : []));
        this.to(index, {
          v: 1,
          type: "room.welcome",
          replyTo: message.id,
          payload: {
            playerId: me.id,
            token: `token-${String(index)}`,
            snapshot: {
              serverNow: 0,
              atSeq: this.seq,
              room: {
                code: CODE,
                state: "running",
                starterId: "p0",
                difficulty: "easy",
                players: Array.from({ length: CLIENTS }, (_, i) => player(i)),
              },
              match: {
                id: "m1",
                puzzle: puzzle(),
                startedAt: 0,
                endedAt: null,
                result: null,
                hintsLeft: 3,
                locked: [],
                groupNotes,
                ranking: null,
              },
              you: {
                playerId: me.id,
                settings: { autoCleanPersonalNotes: true },
                personalNotes: [],
              },
            },
          },
        });
        this.ready.add(index);
        return;
      }
      case "note.add":
      case "note.remove": {
        const { cell, digit } = message.payload;
        const op = message.type === "note.add" ? ("add" as const) : ("remove" as const);
        const next = applyNoteOp(this.notes, op, cell, digit);
        if (next[cell] === this.notes[cell]) {
          coverage.ignored++;
          const ack: ServerEnvelope = {
            v: 1,
            type: "ack",
            replyTo: message.id,
            payload: { applied: false },
          };
          this.replies.set(key, [ack]);
          this.to(index, ack);
          return;
        }
        this.notes = next;
        this.seq++;
        coverage.applied++;
        this.history.push(next.slice());
        const payload = { opSeq: this.seq, layer: "group" as const, op, cell, digit, by: me.id };
        const own: ServerEnvelope = {
          v: 1,
          type: "note.applied",
          seq: this.seq,
          replyTo: message.id,
          payload,
        };
        this.replies.set(key, [own]);
        for (let i = 0; i < CLIENTS; i++) {
          if (!this.ready.has(i)) continue;
          this.to(i, i === index ? own : { v: 1, type: "note.applied", seq: this.seq, payload });
        }
        return;
      }
      default:
        // Presencia y ping no tocan las notas.
        return;
    }
  }
}

type Step =
  | {
      readonly kind: "note";
      readonly client: number;
      readonly cell: number;
      readonly digit: number;
    }
  | { readonly kind: "clear"; readonly client: number; readonly cell: number }
  | { readonly kind: "up" | "down" | "drop" | "back"; readonly client: number };

const client = fc.integer({ min: 0, max: CLIENTS - 1 });
const step: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant("note" as const),
      client,
      cell: fc.integer({ min: 0, max: CELLS - 1 }),
      digit: fc.integer({ min: 1, max: DIGITS }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("clear" as const),
      client,
      cell: fc.integer({ min: 0, max: CELLS - 1 }),
    }),
  },
  { weight: 5, arbitrary: fc.record({ kind: fc.constant("up" as const), client }) },
  { weight: 5, arbitrary: fc.record({ kind: fc.constant("down" as const), client }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("drop" as const), client }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("back" as const), client }) },
);

function same(a: Uint16Array, b: Uint16Array | undefined): boolean {
  return a.length === b?.length && a.every((value, i) => value === b[i]);
}

/** Juega los pasos y comprueba las dos condiciones; devuelve false si alguna falla. */
function converges(steps: readonly Step[]): boolean {
  const server = new ModelServer();
  const lastSeq = new Array<number>(CLIENTS).fill(0);
  const clients = Array.from({ length: CLIENTS }, (_, index) => {
    const link = new LinkTransport(server, index);
    server.links.push(link);
    return new GameClient({ transport: link, prefs: memoryPrefs(), session: memorySession() });
  });
  const up = (index: number) => {
    const message = server.links[index]?.up.shift();
    if (message) server.handle(index, message);
  };
  const down = (index: number) => {
    const message = server.links[index]?.deliverDown();
    if (message?.type === "room.welcome") lastSeq[index] = message.payload.snapshot.atSeq ?? 0;
    else if (message?.seq !== undefined)
      lastSeq[index] = Math.max(lastSeq[index] ?? 0, message.seq);
  };
  const flush = () => {
    for (let guard = 0; guard < 10_000; guard++) {
      const busy = server.links.findIndex((l) => l.up.length > 0 || l.down.length > 0);
      if (busy < 0) return;
      up(busy);
      down(busy);
    }
    throw new Error("The queues never emptied");
  };
  const confirmedMatches = () =>
    clients.every((c, i) => same(c.getState().groupNotes, server.history[lastSeq[i] ?? 0]));

  try {
    clients.forEach((c, i) => {
      c.join(CODE, `Jugador ${String(i)}`);
    });
    flush();
    for (const c of clients) {
      c.setMode("notes");
      c.setLayer("group");
    }
    for (const s of steps) {
      const c = clients[s.client];
      const link = server.links[s.client];
      if (!c || !link) continue;
      switch (s.kind) {
        case "note":
          c.select(s.cell);
          c.input(s.digit);
          break;
        case "clear":
          c.select(s.cell);
          c.clearNotes();
          break;
        case "up":
          up(s.client);
          break;
        case "down":
          down(s.client);
          break;
        case "drop":
          if (link.status === "open") link.drop();
          break;
        case "back":
          if (link.status !== "open") link.open();
          break;
      }
      if (!confirmedMatches()) return false;
    }
    for (const link of server.links) if (link.status !== "open") link.open();
    flush();
    if (!confirmedMatches()) return false;
    return clients.every(
      (c) =>
        c.getState().pendingNotes.length === 0 &&
        same(viewNotes(c.getState(), "group"), server.notes),
    );
  } finally {
    for (const c of clients) c.destroy();
  }
}

describe("T-16.2 group notes converge to the server order (ADR 0005)", () => {
  it("with concurrent operations, out-of-order deliveries and reconnections", () => {
    const seed = assertProperty(
      fc.property(fc.array(step, { minLength: 10, maxLength: 150, size: "max" }), (steps) =>
        converges(steps),
      ),
      { numRuns: 300 },
    );
    expect(coverage.applied, seedMessage(seed)).toBeGreaterThan(1000);
    expect(coverage.ignored, seedMessage(seed)).toBeGreaterThan(50);
    expect(coverage.duplicates, seedMessage(seed)).toBeGreaterThan(10);
    expect(coverage.returns, seedMessage(seed)).toBeGreaterThan(50);
  });
});
