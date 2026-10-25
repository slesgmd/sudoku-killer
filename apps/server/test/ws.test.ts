// Adaptador `ws` de producción (ADR 0002) con conexiones reales en 127.0.0.1: orígenes permitidos,
// ruta, `maxPayload` (1009), mensajes binarios, heartbeat, E-19 (4000) y E-08 (4001). El inspector
// de filtración revisa también todo lo que reciben estos clientes (T-31.1).
import {
  ACCESS_PROTOCOL,
  CLOSE_ACCESS_DENIED,
  CLOSE_REPLACED,
  CLOSE_UNSUPPORTED,
  KEY_PROTOCOL_PREFIX,
  accessProtocols,
  type ServerEnvelope,
} from "@sudoku-killer/protocol";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import {
  ACCESS_FAILURE_WINDOW_MS,
  AccessGate,
  MAX_ACCESS_FAILURES,
  hashAccessKey,
} from "../src/infra/access.ts";
import { HEALTH_PATH, WS_PATH, WsTransport } from "../src/infra/ws-transport.ts";
import { createLogger } from "../src/log/logger.ts";
import { FakeClock } from "./helpers/clock.ts";
import { testBank } from "./helpers/server.ts";
import { TEST_ORIGIN, startWsServer, type RunningWsServer } from "./helpers/ws-server.ts";

const ORIGIN = TEST_ORIGIN;
const WAIT_MS = 5_000;

type Running = RunningWsServer;

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

async function start(options: Parameters<typeof startWsServer>[0] = {}): Promise<Running> {
  running = await startWsServer(options);
  return running;
}

/** Un cliente `ws` real que guarda lo que recibe y deja esperar mensajes y el cierre. */
function connect(
  r: Running,
  {
    origin = ORIGIN,
    autoPong = true,
    path = WS_PATH,
    protocols = [],
    forwardedFor,
  }: {
    origin?: string | null;
    autoPong?: boolean;
    path?: string;
    protocols?: readonly string[];
    forwardedFor?: string;
  } = {},
) {
  const id = ++clientIds;
  const ws = new WebSocket(`ws://127.0.0.1:${String(r.port)}${path}`, [...protocols], {
    autoPong,
    ...(origin === null ? {} : { origin }),
    ...(forwardedFor === undefined ? {} : { headers: { "x-forwarded-for": forwardedFor } }),
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

  it("S-01 above the connection cap the handshake gets 503; a closed connection frees its slot", async () => {
    const r = await start({ maxConnections: 2 });
    const first = connect(r);
    await first.opened;
    await connect(r).opened;
    await expect(connect(r).opened).rejects.toThrow(/HTTP 503/);
    first.ws.close();
    await first.closed;
    await vi.waitFor(() => {
      expect(r.transport.openConnections).toBe(1);
    });
    await connect(r).opened;
  });

  it("only /ws is a WebSocket endpoint", async () => {
    const r = await start();
    await expect(connect(r, { path: "/other" }).opened).rejects.toThrow(/HTTP 404/);
  });
});

describe("F12 access key (R-39, S-02)", () => {
  const KEY = "ABCD-EFGH-JKMN-PQRS";

  it("T-39.2 without the key or with a wrong one the connection closes with 4003 before any room; with it, it plays", async () => {
    const r = await start({ accessKey: KEY });
    const missing = connect(r);
    await missing.opened;
    expect(await missing.closed).toBe(CLOSE_ACCESS_DENIED);
    const withoutKey = connect(r, { protocols: accessProtocols(null) });
    expect(await withoutKey.closed).toBe(CLOSE_ACCESS_DENIED);
    const wrong = connect(r, { protocols: accessProtocols("WXYZ-WXYZ-WXYZ-WXYZ") });
    await wrong.opened;
    wrong.send("room.create", { nickname: "Intrusa" });
    expect(await wrong.closed).toBe(CLOSE_ACCESS_DENIED);
    expect(r.server.rooms.size).toBe(0);
    expect(wrong.messages).toEqual([]);

    // La clave escrita a mano (minúsculas, sin guiones) vale igual; la respuesta elige sk.v1.
    const ok = connect(r, { protocols: accessProtocols("abcdefgh jkmnpqrs") });
    await ok.opened;
    expect(ok.ws.protocol).toBe(ACCESS_PROTOCOL);
    ok.send("room.create", { nickname: "Ana" });
    expect((await ok.next("room.welcome")).type).toBe("room.welcome");
  });

  it("T-39.3 after 10 wrong keys an address gets 429 until the window passes; other addresses are not affected", async () => {
    const r = await start({ accessKey: KEY, trustProxyHops: 1 });
    const bad = accessProtocols("WXYZ-WXYZ-WXYZ-WXYZ");
    for (let i = 0; i < MAX_ACCESS_FAILURES; i++) {
      const attempt = connect(r, { protocols: bad, forwardedFor: "203.0.113.7" });
      expect(await attempt.closed).toBe(CLOSE_ACCESS_DENIED);
    }
    const good = accessProtocols(KEY);
    await expect(
      connect(r, { protocols: good, forwardedFor: "203.0.113.7" }).opened,
    ).rejects.toThrow(/HTTP 429/);
    // Escribir otra IP a la izquierda no cambia la del cliente (la agrega el proxy, a la derecha).
    await expect(
      connect(r, { protocols: good, forwardedFor: "198.51.100.1, 203.0.113.7" }).opened,
    ).rejects.toThrow(/HTTP 429/);
    await connect(r, { protocols: good, forwardedFor: "203.0.113.8" }).opened;
    await r.clock.advance(
      ACCESS_FAILURE_WINDOW_MS,
      () => new Promise<void>((resolve) => setImmediate(resolve)),
    );
    await connect(r, { protocols: good, forwardedFor: "203.0.113.7" }).opened;
  });

  it("negative check: without a configured key the same offers are accepted", async () => {
    const r = await start();
    expect(r.access.required).toBe(false);
    const open = connect(r, { protocols: accessProtocols("WXYZ-WXYZ-WXYZ-WXYZ") });
    await open.opened;
    open.send("room.create", { nickname: "Ana" });
    expect((await open.next("room.welcome")).type).toBe("room.welcome");
  });

  it("never logs the key, its hash or the offered protocol", async () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "debug", write: (line) => lines.push(line) });
    const gate = new AccessGate({ hash: hashAccessKey(KEY), clock: new FakeClock() });
    const transport = new WsTransport({
      host: "127.0.0.1",
      port: 0,
      allowedOrigins: [ORIGIN],
      clock: new FakeClock(),
      logger,
      access: gate,
    });
    await transport.start(() => ({ message: () => undefined, closed: () => undefined }));
    try {
      const url = `ws://127.0.0.1:${String(transport.port)}${WS_PATH}`;
      for (const key of [KEY, "WXYZ-WXYZ-WXYZ-WXYZ"]) {
        const ws = new WebSocket(url, accessProtocols(key), { origin: ORIGIN });
        await new Promise((resolve) => ws.on("open", resolve));
        ws.close();
      }
    } finally {
      await transport.stop(1001, "test over");
    }
    const text = lines.join("\n");
    expect(text).toContain("websocket access denied");
    for (const secret of ["ABCD", "WXYZ", KEY_PROTOCOL_PREFIX, hashAccessKey(KEY).slice(7, 20)])
      expect(text).not.toContain(secret);
  });
});

describe("F12 health check", () => {
  it("GET and HEAD /healthz get 204 without a body; any other path gets 404", async () => {
    const r = await start();
    const base = `http://127.0.0.1:${String(r.port)}`;
    for (const method of ["GET", "HEAD"]) {
      const response = await fetch(`${base}${HEALTH_PATH}`, { method });
      expect(response.status).toBe(204);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("");
    }
    expect((await fetch(`${base}${HEALTH_PATH}`, { method: "POST" })).status).toBe(404);
    expect((await fetch(`${base}/`)).status).toBe(404);
  });
});

describe("S-01 room cap", () => {
  it("above the room cap room.create gets server.unavailable; joining an existing room still works", async () => {
    const r = await start({ maxRooms: 1 });
    const ana = await welcomed(r, "Ana");
    const other = connect(r);
    await other.opened;
    other.send("room.create", { nickname: "Bea" });
    const refused = await other.next("error");
    expect(refused.type === "error" && refused.payload.code).toBe("server.unavailable");
    expect(r.server.rooms.size).toBe(1);
    other.send("room.join", { code: ana.welcome.payload.snapshot.room.code, nickname: "Bea" });
    expect((await other.next("room.welcome")).type).toBe("room.welcome");
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
