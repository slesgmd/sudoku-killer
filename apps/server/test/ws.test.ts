// Adaptador `ws` de producción (ADR 0002) con conexiones reales en 127.0.0.1: orígenes permitidos,
// ruta, `maxPayload` (1009), mensajes binarios, heartbeat, E-19 (4000) y E-08 (4001). El inspector
// de filtración revisa también todo lo que reciben estos clientes (T-31.1).
import { createRng } from "@sudoku-killer/engine";
import { CLOSE_REPLACED, CLOSE_UNSUPPORTED, type ServerEnvelope } from "@sudoku-killer/protocol";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { seededIds } from "../src/infra/random.ts";
import { WS_PATH, WsTransport } from "../src/infra/ws-transport.ts";
import { silentLogger } from "../src/log/logger.ts";
import { createMatchRepository } from "../src/match/repository.ts";
import { EventWriter } from "../src/match/sink.ts";
import { RoomServer } from "../src/rooms/server.ts";
import { FakeClock } from "./helpers/clock.ts";
import { LeakInspector } from "./helpers/inspector.ts";
import { mode, testBank } from "./helpers/server.ts";

const ORIGIN = "http://localhost:5173";
const WAIT_MS = 5_000;

interface Running {
  readonly port: number;
  readonly clock: FakeClock;
  readonly server: RoomServer;
  readonly inspector: LeakInspector;
  stop(): Promise<void>;
}

let running: Running | null = null;
let clientIds = 0;

beforeAll(async () => {
  await testBank();
}, 60_000);

afterEach(async () => {
  const current = running;
  running = null;
  if (!current) return;
  await current.stop();
  expect(current.inspector.violations, "leak inspector (SPEC §8.3)").toEqual([]);
});

async function start(): Promise<Running> {
  const { db, client, catalog, solutions } = await testBank();
  await client.query("TRUNCATE match_events, matches");
  const clock = new FakeClock();
  const repository = createMatchRepository(db);
  const transport = new WsTransport({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [ORIGIN],
    clock,
    logger: silentLogger,
  });
  const server = new RoomServer({
    transport,
    clock,
    random: createRng(7),
    ids: seededIds(createRng(8)),
    catalog,
    sink: new EventWriter({
      repository,
      clock,
      logger: silentLogger,
      schedule: (flush) => {
        setImmediate(flush);
      },
    }),
    repository,
    logger: silentLogger,
    mode,
  });
  await server.start();
  const inspector = new LeakInspector({
    solutions: () => solutions,
    lockedValue: (matchId, cell) => {
      for (const room of server.rooms.values()) {
        const state = room.match?.state;
        const locked = state?.id === matchId ? state.cells[cell] : undefined;
        if (locked?.status === "locked") return locked.value;
      }
      return undefined;
    },
  });
  running = {
    port: transport.port,
    clock,
    server,
    inspector,
    stop: () => transport.stop(1001, "test over"),
  };
  return running;
}

/** Un cliente `ws` real que guarda lo que recibe y deja esperar mensajes y el cierre. */
function connect(
  r: Running,
  {
    origin = ORIGIN,
    autoPong = true,
    path = WS_PATH,
  }: { origin?: string | null; autoPong?: boolean; path?: string } = {},
) {
  const id = ++clientIds;
  const ws = new WebSocket(`ws://127.0.0.1:${String(r.port)}${path}`, {
    autoPong,
    ...(origin === null ? {} : { origin }),
  });
  const messages: ServerEnvelope[] = [];
  const waiters: { test: (m: ServerEnvelope) => boolean; done: (m: ServerEnvelope) => void }[] = [];
  ws.on("message", (data) => {
    const text = (data as Buffer).toString("utf8");
    r.inspector.check(id, text);
    const message = JSON.parse(text) as ServerEnvelope;
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (waiter.test(message)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.done(message);
      }
    }
  });
  const closed = new Promise<number>((resolve) => {
    ws.on("close", (code) => {
      resolve(code);
    });
  });
  const opened = new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      resolve();
    });
    ws.on("unexpected-response", (_request, response) => {
      reject(new Error(`HTTP ${String(response.statusCode)}`));
    });
    ws.on("error", reject);
  });
  const next = (type: ServerEnvelope["type"]) =>
    new Promise<ServerEnvelope>((resolve, reject) => {
      const found = messages.find((m) => m.type === type);
      if (found) {
        messages.splice(messages.indexOf(found), 1);
        resolve(found);
        return;
      }
      const timer = setTimeout(() => {
        reject(new Error(`No ${type} in ${String(WAIT_MS)} ms`));
      }, WAIT_MS);
      waiters.push({
        test: (m) => m.type === type,
        done: (m) => {
          clearTimeout(timer);
          messages.splice(messages.indexOf(m), 1);
          resolve(m);
        },
      });
    });
  let n = 0;
  const send = (type: string, payload: unknown) => {
    ws.send(JSON.stringify({ v: 1, id: `w${String(id)}-${String(++n)}`, type, payload }));
  };
  return { ws, opened, closed, next, send, messages };
}

async function welcomed(r: Running, nickname: string, code?: string, token?: string) {
  const client = connect(r);
  await client.opened;
  if (code === undefined) client.send("room.create", { nickname });
  else
    client.send("room.join", token === undefined ? { code, nickname } : { code, nickname, token });
  const welcome = await client.next("room.welcome");
  if (welcome.type !== "room.welcome") throw new Error();
  return { ...client, welcome };
}

describe("ADR 0002 handshake", () => {
  it("accepts the allowed origin and rejects a missing or foreign one with 403", async () => {
    const r = await start();
    await connect(r).opened;
    await expect(connect(r, { origin: "https://otro-sitio.example" }).opened).rejects.toThrow(
      /HTTP 403/,
    );
    await expect(connect(r, { origin: null }).opened).rejects.toThrow(/HTTP 403/);
    await connect(r, { origin: "HTTP://LOCALHOST:5173/" }).opened;
  });

  it("only /ws is a WebSocket endpoint", async () => {
    const r = await start();
    await expect(connect(r, { path: "/other" }).opened).rejects.toThrow(/HTTP 404/);
  });
});

describe("ADR 0002 messages", () => {
  it("plays over ws: create, ping and start", async () => {
    const r = await start();
    const ana = await welcomed(r, "Ana");
    ana.send("sys.ping", { t0: 5 });
    expect((await ana.next("sys.pong")).payload).toMatchObject({ t0: 5 });
    ana.send("match.start", {});
    expect((await ana.next("match.started")).type).toBe("match.started");
  });

  it("E-18 a message over 16 KiB closes the connection with 1009", async () => {
    const r = await start();
    const client = connect(r);
    await client.opened;
    client.ws.send("x".repeat(17 * 1024));
    expect(await client.closed).toBe(1009);
  });

  it("a binary message gets bad_request", async () => {
    const r = await start();
    const client = connect(r);
    await client.opened;
    client.ws.send(Buffer.from([1, 2, 3]));
    expect((await client.next("error")).payload).toEqual({ code: "bad_request" });
  });

  it("E-19 another protocol version gets protocol.unsupported and closes with 4000", async () => {
    const r = await start();
    const client = connect(r);
    await client.opened;
    client.ws.send(JSON.stringify({ v: 2, id: "a", type: "sys.ping", payload: { t0: 1 } }));
    expect((await client.next("error")).payload).toEqual({ code: "protocol.unsupported" });
    expect(await client.closed).toBe(CLOSE_UNSUPPORTED);
  });

  it("E-08 the same token on a second connection closes the first with 4001", async () => {
    const r = await start();
    const ana = await welcomed(r, "Ana");
    const { token, snapshot } = ana.welcome.payload;
    if (token === undefined) throw new Error("No token");
    await welcomed(r, "Ana", snapshot.room.code, token);
    expect(await ana.closed).toBe(CLOSE_REPLACED);
  });
});

describe("ADR 0002 heartbeat", () => {
  it("a connection that does not answer the ping is terminated and the player is disconnected", async () => {
    const r = await start();
    const ana = await welcomed(r, "Ana");
    const code = ana.welcome.payload.snapshot.room.code;
    const silent = connect(r, { autoPong: false });
    await silent.opened;
    silent.send("room.join", { code, nickname: "Bea" });
    await silent.next("room.welcome");
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await r.server.idle();
    };
    await r.clock.advance(15_000, settle); // primer ping: los dos lo reciben
    await r.clock.advance(15_000, settle); // Bea no respondió: se termina
    expect(await silent.closed).toBe(1006);
    await settle();
    const room = r.server.rooms.get(code);
    const bea = [...(room?.members.values() ?? [])].find((m) => m.nickname === "Bea");
    expect(bea?.connection).toBe("disconnected");
    expect(ana.ws.readyState).toBe(WebSocket.OPEN);
  });
});
