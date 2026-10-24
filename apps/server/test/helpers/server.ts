// Servidor de pruebas de integración (SPEC §8.1 y §8.2): el servidor de salas real con el transporte
// en memoria, el reloj falso, azar con semilla, el banco en PGlite y el inspector de filtración
// siempre activo. Al terminar cada prueba se comprueba que el inspector no encontró nada y que el log
// no tiene fichas ni sus hash.
import type { PGlite } from "@electric-sql/pglite";
import { createRng } from "@sudoku-killer/engine";
import { createNormalMode, type MatchEvent, type MatchState } from "@sudoku-killer/game";
import type { ClientMessage, ClientMessageType, ServerEnvelope } from "@sudoku-killer/protocol";
import { PARAMS_V1 } from "@sudoku-killer/scoring";
import { expect, onTestFinished } from "vitest";
import { MemoryTransport, type MemoryClient } from "../../src/infra/memory-transport.ts";
import { seededIds } from "../../src/infra/random.ts";
import { createLogger } from "../../src/log/logger.ts";
import {
  createMatchRepository,
  type CommitBatch,
  type MatchRepository,
  type StoredMatch,
} from "../../src/match/repository.ts";
import { EventWriter } from "../../src/match/sink.ts";
import { createPuzzleCatalog, type PuzzleCatalog } from "../../src/puzzles/catalog.ts";
import { loadBank } from "../../src/puzzles/load-bank.ts";
import { createPuzzleRepository } from "../../src/puzzles/repository.ts";
import type { Room } from "../../src/rooms/room.ts";
import { RoomServer } from "../../src/rooms/server.ts";
import type { Database } from "../../src/db/database.ts";
import { readManifest } from "./bank.ts";
import { FakeClock } from "./clock.ts";
import { createTestDatabase } from "./db.ts";
import { LeakInspector } from "./inspector.ts";

export const mode = createNormalMode(PARAMS_V1);

/** Semillas del banco de pruebas: dos fáciles (para no repetir, T-21.1) y una de cada dificultad. */
const BANK_SEEDS = { easy: 2, medium: 1, hard: 1, expert: 1 } as const;

export interface TestBank {
  readonly db: Database;
  readonly client: PGlite;
  readonly catalog: PuzzleCatalog;
  readonly solutions: readonly (readonly number[])[];
}

let bank: Promise<TestBank> | null = null;

/** El banco de pruebas, cargado una vez por archivo de pruebas. */
export function testBank(): Promise<TestBank> {
  bank ??= (async () => {
    const { db, client } = await createTestDatabase();
    const manifest = readManifest();
    const taken = { easy: 0, medium: 0, hard: 0, expert: 0 };
    const entries = manifest.entries.filter((entry) => {
      if (taken[entry.difficulty] >= BANK_SEEDS[entry.difficulty]) return false;
      taken[entry.difficulty]++;
      return true;
    });
    await loadBank(db, { ...manifest, entries });
    const repository = createPuzzleRepository(db);
    const catalog = await createPuzzleCatalog(repository);
    const ids = await db.query.puzzles.findMany({ columns: { id: true } });
    const solutions: number[][] = [];
    for (const { id } of ids) {
      const record = await repository.getForServer(id);
      if (record) solutions.push([...record.solution]);
    }
    return { db, client, catalog, solutions };
  })();
  return bank;
}

/**
 * El repositorio real sobre PGlite, con un interruptor que hace fallar la base de datos a pedido
 * (E-16). `events` sigue respondiendo: las pruebas leen el registro confirmado.
 */
export class FaultyRepository implements MatchRepository {
  failing = false;
  private readonly inner: MatchRepository;

  constructor(inner: MatchRepository) {
    this.inner = inner;
  }

  private guard<T>(run: () => Promise<T>): Promise<T> {
    return this.failing ? Promise.reject(new Error("database unavailable")) : run();
  }

  commit(batch: CommitBatch): Promise<void> {
    return this.guard(() => this.inner.commit(batch));
  }

  listRunning(): Promise<StoredMatch[]> {
    return this.guard(() => this.inner.listRunning());
  }

  loadRunning(matchId: string): Promise<StoredMatch | null> {
    return this.guard(() => this.inner.loadRunning(matchId));
  }

  events(matchId: string): Promise<MatchEvent[]> {
    return this.inner.events(matchId);
  }
}

export interface TestServerOptions {
  readonly seed?: number;
}

export type TestServer = Awaited<ReturnType<typeof createTestServer>>;

export async function createTestServer({ seed = 1 }: TestServerOptions = {}) {
  const { db, client, catalog, solutions } = await testBank();
  // Las pruebas de un archivo comparten la base: cada servidor nuevo empieza sin partidas, para no
  // reconstruir las de otra prueba. (TRUNCATE no pasa por el trigger de UPDATE y DELETE.)
  await client.query("TRUNCATE match_events, matches");
  const repository = new FaultyRepository(createMatchRepository(db));
  const clock = new FakeClock();
  const logs: string[] = [];
  const logger = createLogger({
    level: "debug",
    write: (line) => logs.push(line),
    now: () => clock.now(),
  });
  let live: RoomServer | null = null;
  const matchState = (matchId: string): MatchState | undefined => {
    for (const room of live?.rooms.values() ?? []) {
      if (room.match?.state.id === matchId) return room.match.state;
    }
    return undefined;
  };
  const inspector = new LeakInspector({
    solutions: () => solutions,
    lockedValue: (matchId, cell) => {
      const state = matchState(matchId)?.cells[cell];
      return state?.status === "locked" ? state.value : undefined;
    },
  });
  const tokens = new Set<string>();
  let transport = new MemoryTransport();
  let sink: EventWriter | null = null;
  let generation = 0;

  /** Arranca un servidor (el primero o el que sigue a un reinicio) sobre la misma base. */
  const boot = async () => {
    generation++;
    transport = new MemoryTransport((clientId, text) => {
      inspector.check(clientId, text);
    });
    // En las pruebas, el lote se escribe en cuanto se vacía la cola de microtareas: agrupa lo que
    // llegó en la misma tanda sin depender del reloj falso. Los reintentos sí usan el reloj (E-16).
    sink = new EventWriter({
      repository,
      clock,
      logger,
      schedule: (flush) => {
        setImmediate(flush);
      },
    });
    live = new RoomServer({
      transport,
      clock,
      random: createRng(seed + generation),
      ids: seededIds(createRng(seed + 1_000 * generation)),
      catalog,
      sink,
      repository,
      logger,
      mode,
    });
    return live.start();
  };
  await boot();

  const server = (): RoomServer => {
    if (!live) throw new Error("No server");
    return live;
  };

  onTestFinished(() => {
    expect(inspector.violations, "leak inspector (SPEC §8.3)").toEqual([]);
    const joined = logs.join(" ");
    for (const token of tokens) expect(joined, "a token in the log").not.toContain(token);
    expect(joined, "a token hash in the log").not.toMatch(/[0-9a-f]{64}/);
  });

  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      await server().idle();
      await new Promise((resolve) => setImmediate(resolve));
    }
  };

  const harness = {
    get server(): RoomServer {
      return server();
    },
    get sink(): EventWriter {
      if (!sink) throw new Error("No sink");
      return sink;
    },
    clock,
    repository,
    inspector,
    logs,
    settle,
    /** Avanza el reloj falso y procesa lo que dispare. */
    advance: (ms: number) => clock.advance(ms, settle),
    /**
     * Reinicio del servidor (E-15): el proceso viejo deja de existir sin avisar a nadie (sus salas
     * no procesan nada más y sus conexiones se cortan) y arranca uno nuevo sobre la misma base.
     * Devuelve cuántas salas reconstruyó.
     */
    async restart(): Promise<number> {
      await settle();
      const old = server();
      for (const room of [...old.rooms.values()]) room.deleted = true;
      await transport.stop(1006, "");
      const restored = await boot();
      await settle();
      return restored;
    },
    room(code: string): Room {
      const room = server().rooms.get(code);
      if (!room) throw new Error(`No room ${code}`);
      return room;
    },
    /** La solución de la partida de la sala (solo en las pruebas). */
    solutionOf(code: string): readonly number[] {
      const match = harness.room(code).match;
      if (!match) throw new Error(`No match in ${code}`);
      return match.solution;
    },
    client(): TestClient {
      return new TestClient(transport.connect(), settle, tokens);
    },
  };
  return harness;
}

type Payload<T extends ClientMessageType> = ClientMessage<T>["payload"];

/** Un cliente de pruebas: envía comandos con `id` propios y lee lo que recibe. */
export class TestClient {
  readonly link: MemoryClient;
  playerId: string | null = null;
  token: string | null = null;
  code: string | null = null;
  private readonly settle: () => Promise<void>;
  private readonly tokens: Set<string>;
  private nextId = 1;

  constructor(link: MemoryClient, settle: () => Promise<void>, tokens: Set<string>) {
    this.link = link;
    this.settle = settle;
    this.tokens = tokens;
  }

  get messages(): ServerEnvelope[] {
    return this.link.received.map((text) => JSON.parse(text) as ServerEnvelope);
  }

  /** Cuántos mensajes recibió: para mirar solo los posteriores con `since`. */
  mark(): number {
    return this.link.received.length;
  }

  since(mark: number): ServerEnvelope[] {
    return this.messages.slice(mark);
  }

  all<T extends ServerEnvelope["type"]>(type: T, from = 0): Extract<ServerEnvelope, { type: T }>[] {
    return this.since(from).filter(
      (m): m is Extract<ServerEnvelope, { type: T }> => m.type === type,
    );
  }

  last<T extends ServerEnvelope["type"]>(
    type: T,
  ): Extract<ServerEnvelope, { type: T }> | undefined {
    return this.all(type).at(-1);
  }

  /** Las respuestas a un comando (las que llevan su `replyTo`). */
  replies(id: string): ServerEnvelope[] {
    return this.messages.filter((m) => m.replyTo === id);
  }

  /** Envía un comando sin esperar. Devuelve su `id`. */
  post<T extends ClientMessageType>(type: T, payload: Payload<T>, id?: string): string {
    const msgId = id ?? `${String(this.link.id)}-${String(this.nextId++)}`;
    this.link.send(JSON.stringify({ v: 1, id: msgId, type, payload }));
    return msgId;
  }

  /** Envía un comando y espera a que el servidor lo procese. Devuelve sus respuestas. */
  async send<T extends ClientMessageType>(
    type: T,
    payload: Payload<T>,
    id?: string,
  ): Promise<ServerEnvelope[]> {
    const msgId = this.post(type, payload, id);
    await this.settle();
    return this.replies(msgId);
  }

  private remember(replies: ServerEnvelope[]): ServerEnvelope[] {
    const welcome = replies.find((m) => m.type === "room.welcome");
    if (welcome?.type === "room.welcome") {
      this.playerId = welcome.payload.playerId;
      this.code = welcome.payload.snapshot.room.code;
      if (welcome.payload.token !== undefined) {
        this.token = welcome.payload.token;
        this.tokens.add(welcome.payload.token);
      }
    }
    return replies;
  }

  async create(nickname: string): Promise<ServerEnvelope[]> {
    return this.remember(await this.send("room.create", { nickname }));
  }

  async join(code: string, nickname: string, token?: string): Promise<ServerEnvelope[]> {
    return this.remember(
      await this.send(
        "room.join",
        token === undefined ? { code, nickname } : { code, nickname, token },
      ),
    );
  }

  /** El cliente se cae (sin `room.leave`). */
  async drop(): Promise<void> {
    this.link.disconnect();
    await this.settle();
  }
}

/** La bienvenida de un conjunto de respuestas, o falla. */
export function welcomeOf(
  replies: readonly ServerEnvelope[],
): Extract<ServerEnvelope, { type: "room.welcome" }> {
  const welcome = replies.find((m) => m.type === "room.welcome");
  if (welcome?.type !== "room.welcome") throw new Error(`No welcome in ${JSON.stringify(replies)}`);
  return welcome;
}

/** El código de error de un conjunto de respuestas, o `undefined`. */
export function errorOf(replies: readonly ServerEnvelope[]): string | undefined {
  const error = replies.find((m) => m.type === "error");
  return error?.type === "error" ? error.payload.code : undefined;
}
