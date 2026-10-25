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
import { request as httpRequest } from "node:http";
import { createConnection, createServer as createTcpServer, type Server } from "node:net";
import WebSocket from "ws";
import {
  ACCESS_FAILURE_WINDOW_MS,
  AccessGate,
  MAX_ACCESS_FAILURES,
  hashAccessKey,
} from "../src/infra/access.ts";
import { DENY_GRACE_MS, HEALTH_PATH, WS_PATH, WsTransport } from "../src/infra/ws-transport.ts";
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
    port = r.port,
  }: {
    origin?: string | null;
    autoPong?: boolean;
    path?: string;
    protocols?: readonly string[];
    forwardedFor?: string;
    /** Otro puerto delante del servidor (el proxy de T-39.11). */
    port?: number;
  } = {},
) {
  const id = ++clientIds;
  const ws = new WebSocket(`ws://127.0.0.1:${String(port)}${path}`, [...protocols], {
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

/**
 * Cómo termina un intento: `HTTP <status>` si el handshake no se acepta, `close <código>` si el
 * servidor cierra tras el primer mensaje (el navegador lo envía en cuanto abre, T-39.11), u `open`
 * si la conexión sigue abierta (y se cierra).
 */
async function handshake(r: Running, options: Parameters<typeof connect>[1]): Promise<string> {
  const client = connect(r, options);
  try {
    await client.opened;
  } catch (error) {
    client.ws.terminate();
    return (error as Error).message;
  }
  client.send("sys.ping", { t0: 1 });
  return Promise.race([
    client.closed.then((code) => `close ${String(code)}`),
    new Promise<string>((resolve) =>
      setTimeout(() => {
        client.ws.close();
        resolve("open");
      }, 500),
    ),
  ]);
}

/** El handshake con `node:http`, para leer el estado y las cabeceras de una respuesta que no es 101. */
function rawHandshake(r: Running, protocols: readonly string[], forwardedFor: string) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined> }>(
    (resolve, reject) => {
      const request = httpRequest({
        host: "127.0.0.1",
        port: r.port,
        path: WS_PATH,
        headers: {
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-version": "13",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
          "sec-websocket-protocol": protocols.join(", "),
          origin: ORIGIN,
          "x-forwarded-for": forwardedFor,
        },
      });
      request.on("response", (response) => {
        response.resume();
        resolve({ status: response.statusCode ?? 0, headers: response.headers });
      });
      request.on("upgrade", (_response, socket) => {
        socket.destroy();
        reject(new Error("the handshake was accepted"));
      });
      request.on("error", reject);
      request.end();
    },
  );
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
    missing.send("room.create", { nickname: "Ana" });
    expect(await missing.closed).toBe(CLOSE_ACCESS_DENIED);
    expect(await handshake(r, { protocols: accessProtocols(null) })).toBe("close 4003");
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
    for (let i = 0; i < MAX_ACCESS_FAILURES; i++)
      expect(await handshake(r, { protocols: bad, forwardedFor: "203.0.113.7" })).toBe(
        "close 4003",
      );
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

  it("T-39.3 the 429 is a real HTTP answer to the handshake, with Retry-After", async () => {
    const r = await start({ accessKey: KEY, trustProxyHops: 1 });
    const bad = accessProtocols("WXYZ-WXYZ-WXYZ-WXYZ");
    for (let i = 0; i < MAX_ACCESS_FAILURES; i++)
      expect(await handshake(r, { protocols: bad, forwardedFor: "203.0.113.7" })).toBe(
        "close 4003",
      );
    const answer = await rawHandshake(r, accessProtocols(KEY), "203.0.113.7");
    expect(answer.status).toBe(429);
    expect(Number(answer.headers["retry-after"])).toBeGreaterThan(0);
    expect(Number(answer.headers["retry-after"])).toBeLessThanOrEqual(
      ACCESS_FAILURE_WINDOW_MS / 1000,
    );
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

// El fallo del primer despliegue (F12j): detrás del proxy de Render, cada intento recibía 429 sin
// que ninguna clave se hubiera rechazado desde el navegador. Las cabeceras son las que arma un proxy:
// lo que trae el cliente a la izquierda y, a la derecha, una entrada por proxy.
describe("F12 access behind the proxy (T-39.7, T-39.8, T-39.9)", () => {
  const KEY = "ABCD-EFGH-JKMN-PQRS";
  const WRONG = "WXYZ-WXYZ-WXYZ-WXYZ";

  it("T-39.7 browsers without a key are never locked out, even many behind the same proxy entry", async () => {
    const r = await start({ accessKey: KEY, trustProxyHops: 1 });
    // Doce navegadores sin clave guardada, de redes distintas, que llegan por la misma IP del borde.
    for (let i = 1; i <= MAX_ACCESS_FAILURES + 2; i++)
      expect(
        await handshake(r, {
          protocols: accessProtocols(null),
          forwardedFor: `198.51.100.${String(i)}, 203.0.113.250`,
        }),
        `browser ${String(i)}`,
      ).toBe("close 4003");
    await connect(r, {
      protocols: accessProtocols(KEY),
      forwardedFor: "198.51.100.99, 203.0.113.250",
    }).opened;
    // Ninguno escribió una clave: cuentan como conexiones sin clave, no como claves rechazadas.
    expect(r.access.missing).toBe(MAX_ACCESS_FAILURES + 2);
    expect(r.access.denied).toBe(0);
  });

  it("T-39.8 an address that cannot be determined does not lock everyone together", async () => {
    const r = await start({ accessKey: KEY, trustProxyHops: 2 });
    // Sin la cabecera, con menos entradas que los proxies de confianza o con una que no es una IP.
    for (const forwardedFor of [undefined, "", "203.0.113.7", "unknown, 10.0.0.1", "_hidden, x"])
      for (let i = 0; i < MAX_ACCESS_FAILURES; i++)
        expect(
          await handshake(r, {
            protocols: accessProtocols(WRONG),
            ...(forwardedFor === undefined ? {} : { forwardedFor }),
          }),
        ).toBe("close 4003");
    await connect(r, { protocols: accessProtocols(KEY) }).opened;
    await connect(r, { protocols: accessProtocols(KEY), forwardedFor: "203.0.113.7" }).opened;
    await connect(r, { protocols: accessProtocols(KEY), forwardedFor: "192.0.2.1, 10.0.0.1" })
      .opened;
  });

  it("T-39.8 the same address in another format is the same address (port, IPv6 brackets, IPv4-mapped)", async () => {
    const r = await start({ accessKey: KEY, trustProxyHops: 1 });
    const bad = accessProtocols(WRONG);
    const good = accessProtocols(KEY);
    for (let i = 0; i < MAX_ACCESS_FAILURES; i++)
      await handshake(r, { protocols: bad, forwardedFor: "203.0.113.7:51234" });
    for (const forwardedFor of ["203.0.113.7", "::ffff:203.0.113.7", "x, 203.0.113.7:443"])
      expect(await handshake(r, { protocols: good, forwardedFor }), forwardedFor).toBe("HTTP 429");
    for (let i = 0; i < MAX_ACCESS_FAILURES; i++)
      await handshake(r, { protocols: bad, forwardedFor: "[2001:DB8::7]:443" });
    expect(await handshake(r, { protocols: good, forwardedFor: "2001:db8::7" })).toBe("HTTP 429");
    await connect(r, { protocols: good, forwardedFor: "203.0.113.8" }).opened;
  });

  it("T-39.9 GET /ws answers what the handshake would get: 403, 429 with Retry-After, or 204, readable across origins", async () => {
    const r = await start({ accessKey: KEY, trustProxyHops: 1 });
    const probe = (origin: string, forwardedFor: string) =>
      fetch(`http://127.0.0.1:${String(r.port)}${WS_PATH}`, {
        headers: { origin, "x-forwarded-for": forwardedFor },
      });
    const fine = await probe(ORIGIN, "203.0.113.7");
    expect(fine.status).toBe(204);
    expect(fine.headers.get("access-control-allow-origin")).toBe("*");
    expect(fine.headers.get("cache-control")).toBe("no-store");
    expect((await probe("https://otro-sitio.example", "203.0.113.7")).status).toBe(403);
    for (let i = 0; i < MAX_ACCESS_FAILURES; i++)
      await handshake(r, { protocols: accessProtocols(WRONG), forwardedFor: "203.0.113.7" });
    const locked = await probe(ORIGIN, "203.0.113.7");
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(locked.headers.get("access-control-expose-headers")).toMatch(/retry-after/i);
    expect((await probe(ORIGIN, "203.0.113.8")).status).toBe(204);
    // Un `fetch` del mismo origen (desarrollo y E2E) no siempre manda `Origin`.
    const sameOrigin = await fetch(`http://127.0.0.1:${String(r.port)}${WS_PATH}`, {
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    expect(sameOrigin.status).toBe(429);
  });
});

/**
 * Un proxy TCP que se porta como el de Render en el primer despliegue (F12j): reenvía el handshake y
 * su 101, pero pierde lo que el servidor envía detrás del 101 antes de que el cliente envíe algo.
 * Así, un 4003 enviado junto con el 101 nunca llegaba, y el navegador lo veía como un 1006.
 */
async function earlyDropProxy(target: number): Promise<{ port: number; close(): Promise<void> }> {
  const sockets = new Set<{ destroy(): void }>();
  const server: Server = createTcpServer((client) => {
    const upstream = createConnection({ host: "127.0.0.1", port: target });
    sockets.add(client);
    sockets.add(upstream);
    let request = Buffer.alloc(0);
    let requestDone = false;
    let clientSpoke = false;
    let response = Buffer.alloc(0);
    let responseDone = false;
    client.on("data", (chunk: Buffer) => {
      if (requestDone) {
        clientSpoke = true;
      } else {
        request = Buffer.concat([request, chunk]);
        const end = request.indexOf("\r\n\r\n");
        if (end >= 0) {
          requestDone = true;
          clientSpoke = end + 4 < request.length;
        }
      }
      upstream.write(chunk);
    });
    upstream.on("data", (chunk: Buffer) => {
      let rest = chunk;
      if (!responseDone) {
        response = Buffer.concat([response, chunk]);
        const end = response.indexOf("\r\n\r\n");
        if (end < 0) return;
        responseDone = true;
        client.write(response.subarray(0, end + 4));
        rest = response.subarray(end + 4);
      }
      if (clientSpoke && rest.length > 0) client.write(rest);
    });
    const finish = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("close", finish);
    upstream.on("close", finish);
    client.on("error", finish);
    upstream.on("error", finish);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    port: typeof address === "object" && address ? address.port : 0,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          resolve();
        });
      }),
  };
}

describe("F12 the 4003 reaches the browser behind the proxy (T-39.11)", () => {
  const KEY = "ABCD-EFGH-JKMN-PQRS";

  it("T-39.11 behind a proxy that loses what follows the 101, without a key or with a wrong one the client still gets 4003; with the key it plays", async () => {
    const r = await start({ accessKey: KEY });
    const proxy = await earlyDropProxy(r.port);
    try {
      expect(await handshake(r, { port: proxy.port, protocols: accessProtocols(null) })).toBe(
        "close 4003",
      );
      expect(
        await handshake(r, { port: proxy.port, protocols: accessProtocols("WXYZ-WXYZ-WXYZ-WXYZ") }),
      ).toBe("close 4003");
      const ok = connect(r, { port: proxy.port, protocols: accessProtocols(KEY) });
      await ok.opened;
      ok.send("room.create", { nickname: "Ana" });
      expect((await ok.next("room.welcome")).type).toBe("room.welcome");
      ok.ws.close();
      await ok.closed;
    } finally {
      await proxy.close();
    }
    expect(r.access.missing).toBe(1);
    expect(r.access.denied).toBe(1);
  });

  it("T-39.11 a client without the key that never sends anything is closed with 4003 after the grace period", async () => {
    const r = await start({ accessKey: KEY });
    const silent = connect(r, { protocols: accessProtocols(null) });
    await silent.opened;
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
    await r.clock.advance(DENY_GRACE_MS - 1, settle);
    expect(silent.ws.readyState).toBe(WebSocket.OPEN);
    await r.clock.advance(1, settle);
    expect(await silent.closed).toBe(CLOSE_ACCESS_DENIED);
    expect(r.server.rooms.size).toBe(0);
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

describe("F12 per-address cap and HTTP timeouts (S-01, S-06)", () => {
  it("S-01 above the per-address cap the handshake gets 503; other addresses and a freed slot get in; a spoofed entry does not evade it", async () => {
    const r = await start({ maxConnectionsPerIp: 2, trustProxyHops: 1 });
    const first = connect(r, { forwardedFor: "203.0.113.7" });
    await first.opened;
    await connect(r, { forwardedFor: "198.51.100.9, 203.0.113.7" }).opened;
    await expect(connect(r, { forwardedFor: "203.0.113.7" }).opened).rejects.toThrow(/HTTP 503/);
    await expect(connect(r, { forwardedFor: "192.0.2.1, 203.0.113.7" }).opened).rejects.toThrow(
      /HTTP 503/,
    );
    await connect(r, { forwardedFor: "203.0.113.8" }).opened;
    first.ws.close();
    await first.closed;
    await vi.waitFor(async () => {
      await connect(r, { forwardedFor: "203.0.113.7" }).opened;
    });
  });

  it("without trusted proxies the socket address counts, and X-Forwarded-For is ignored", async () => {
    const r = await start({ maxConnectionsPerIp: 1 });
    await connect(r, { forwardedFor: "203.0.113.7" }).opened;
    await expect(connect(r, { forwardedFor: "203.0.113.8" }).opened).rejects.toThrow(/HTTP 503/);
  });

  it("S-06 a client that never finishes its headers is cut off after the HTTP timeout", async () => {
    const r = await start({ httpTimeoutMs: 300 });
    const socket = createConnection({ host: "127.0.0.1", port: r.port });
    await new Promise((resolve) => socket.once("connect", resolve));
    let answer = "";
    // Sin leer, el socket nunca llega a cerrarse.
    socket.on("data", (chunk: Buffer) => (answer += chunk.toString("utf8")));
    const started = Date.now();
    socket.write("GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\n");
    await new Promise((resolve) => socket.once("close", resolve));
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(3_000);
    expect(answer).toMatch(/^HTTP\/1\.1 408/);
  });

  it("S-06 the HTTP timeout does not cut an open WebSocket", async () => {
    const r = await start({ httpTimeoutMs: 300 });
    const client = connect(r);
    await client.opened;
    await new Promise((resolve) => setTimeout(resolve, 900));
    client.send("sys.ping", { t0: 1 });
    expect((await client.next("sys.pong")).type).toBe("sys.pong");
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
