// Transporte WebSocket del cliente (ADR 0002) con un WebSocket y un reloj falsos: espera
// exponencial con jitter, `unavailable` a los 10 s, códigos de cierre 4000, 4001 y 4002, validación
// de los mensajes entrantes y reconexión inmediata al volver a primer plano, al restaurar la página
// desde la caché o al recuperar la red.
import { ACCESS_KEY_HEADER, encodeAccessKey, type ServerEnvelope } from "@sudoku-killer/protocol";
import { describe, expect, it } from "vitest";
import type { TransportStatus } from "../src/transport/types.ts";
import {
  RETRY_MAX_MS,
  RETRY_MIN_MS,
  UNAVAILABLE_AFTER_MS,
  createWsTransport,
  httpAccess,
  httpProbe,
  retryDelay,
  sameOriginUrl,
  type Scheduler,
  type SocketLike,
} from "../src/transport/ws.ts";

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: { readonly code: number }) => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly sent: string[] = [];
  closedWith: number | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000): void {
    this.closedWith = code;
    this.readyState = 3;
  }

  /** El servidor acepta la conexión. */
  accept(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  /** La conexión se cierra con `code` (del servidor o de la red). */
  drop(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  deliver(data: unknown): void {
    this.onmessage?.({ data });
  }
}

class FakeScheduler implements Scheduler {
  now = 0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private next = 1;

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.timers.push({ at: this.now + ms, fn, id });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.now = due.at;
      due.fn();
    }
    this.now = target;
  }
}

function setup({ random = () => 0 }: { random?: () => number } = {}) {
  const sockets: FakeSocket[] = [];
  const scheduler = new FakeScheduler();
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const statuses: TransportStatus[] = [];
  const received: ServerEnvelope[] = [];
  const debug: string[] = [];
  const transport = createWsTransport({
    url: "ws://example.test/ws",
    open: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    scheduler,
    random,
    window: win,
    document: doc,
    debug: (message) => debug.push(message),
  });
  transport.onStatus((status) => statuses.push(status));
  transport.subscribe((message) => received.push(message));
  const last = () => {
    const socket = sockets.at(-1);
    if (!socket) throw new Error("No socket");
    return socket;
  };
  return { transport, sockets, scheduler, win, doc, statuses, received, debug, last };
}

const pong = { v: 1, type: "sys.pong", payload: { t0: 1, serverNow: 2 } };

describe("WebSocket transport (ADR 0002)", () => {
  it("builds the same-origin URL", () => {
    expect(sameOriginUrl({ protocol: "http:", host: "192.168.1.5:5173" })).toBe(
      "ws://192.168.1.5:5173/ws",
    );
    expect(sameOriginUrl({ protocol: "https:", host: "sk.example" })).toBe("wss://sk.example/ws");
  });

  it("waits between 0.5 and 5 s, with jitter between half and the full delay", () => {
    expect(retryDelay(0, () => 0)).toBe(RETRY_MIN_MS / 2);
    expect(retryDelay(0, () => 0.999_999)).toBe(RETRY_MIN_MS);
    expect(retryDelay(3, () => 0)).toBe(2000);
    expect(retryDelay(10, () => 0.999_999)).toBe(RETRY_MAX_MS);
    for (let attempt = 0; attempt < 12; attempt++) {
      const delay = retryDelay(attempt, Math.random);
      expect(delay).toBeGreaterThanOrEqual(RETRY_MIN_MS / 2);
      expect(delay).toBeLessThanOrEqual(RETRY_MAX_MS);
    }
  });

  it("connects only on demand, validates incoming messages and drops sends while closed", () => {
    const { transport, sockets, statuses, received, debug, last } = setup();
    expect(transport.status).toBe("idle");
    expect(sockets).toHaveLength(0);
    transport.send({ v: 1, id: "a", type: "sys.ping", payload: { t0: 1 } });
    transport.connect();
    expect(statuses).toEqual(["connecting"]);
    last().accept();
    expect(transport.status).toBe("open");
    last().deliver(JSON.stringify(pong));
    last().deliver("not json");
    last().deliver(JSON.stringify({ v: 1, type: "cell.solved", payload: { cell: "x" } }));
    last().deliver(JSON.stringify({ v: 1, type: "room.unknown", payload: {} }));
    expect(received).toHaveLength(1);
    expect(debug.some((line) => line.includes("unknown_type room.unknown"))).toBe(true);
    // Lo que sale al log es el tipo, nunca el contenido.
    expect(debug.join(" ")).not.toContain("payload");
    transport.send({ v: 1, id: "b", type: "sys.ping", payload: { t0: 1 } });
    expect(last().sent).toHaveLength(1);
    expect(JSON.parse(last().sent[0] ?? "{}")).toMatchObject({ id: "b" });
  });

  it("reconnects with exponential backoff and goes unavailable after 10 s", () => {
    const { transport, sockets, scheduler, statuses, last } = setup();
    transport.connect();
    last().accept();
    last().drop(1006);
    expect(transport.status).toBe("reconnecting");
    expect(sockets).toHaveLength(1);
    // Con jitter 0: 250, 500, 1000, 2000 y 2500 ms (la mitad de cada espera).
    for (const wait of [250, 500, 1000, 2000]) {
      scheduler.advance(wait - 1);
      const before = sockets.length;
      scheduler.advance(1);
      expect(sockets.length).toBe(before + 1);
      last().drop(1006);
    }
    expect(scheduler.now).toBe(3750);
    scheduler.advance(UNAVAILABLE_AFTER_MS - 3750);
    expect(transport.status).toBe("unavailable");
    // Sigue reintentando y, al abrir, la espera vuelve al mínimo.
    scheduler.advance(RETRY_MAX_MS);
    last().accept();
    expect(transport.status).toBe("open");
    last().drop(1012);
    const before = sockets.length;
    scheduler.advance(250);
    expect(sockets.length).toBe(before + 1);
    expect(statuses).toEqual([
      "connecting",
      "open",
      "reconnecting",
      "unavailable",
      "open",
      "reconnecting",
    ]);
  });

  it("does not reconnect after 4001 (another tab) or 4000 (version); 4002 leaves it idle", () => {
    for (const [code, status] of [
      [4001, "replaced"],
      [4000, "incompatible"],
      [4002, "idle"],
      [4003, "denied"],
    ] as const) {
      const { transport, sockets, scheduler, last } = setup();
      transport.connect();
      last().accept();
      last().drop(code);
      expect(transport.status).toBe(status);
      scheduler.advance(60_000);
      expect(sockets).toHaveLength(1);
    }
  });

  it("T-39.4 each attempt offers the protocols of that moment, and reconnect() after 4003 uses the new key", () => {
    const offered: (readonly string[])[] = [];
    let key: string | null = null;
    const transport = createWsTransport({
      url: "ws://example.test/ws",
      open: (_url, protocols) => {
        offered.push(protocols);
        return new FakeSocket();
      },
      protocols: () => (key === null ? ["sk.v1"] : ["sk.v1", `sk.k.${key}`]),
      scheduler: new FakeScheduler(),
      window: null,
      document: null,
    });
    transport.connect();
    key = "QUJD";
    transport.reconnect();
    expect(offered).toEqual([["sk.v1"], ["sk.v1", "sk.k.QUJD"]]);
  });

  describe("T-39.10 a rejected handshake is not a sleeping server", () => {
    const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    function probed(answer: () => Promise<number | null>) {
      const sockets: FakeSocket[] = [];
      const scheduler = new FakeScheduler();
      let asked = 0;
      const transport = createWsTransport({
        url: "wss://example.test/ws",
        open: () => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket;
        },
        scheduler,
        random: () => 0,
        window: null,
        document: null,
        probe: () => {
          asked++;
          return answer();
        },
      });
      const last = () => sockets.at(-1) ?? new FakeSocket();
      return { transport, sockets, scheduler, last, asked: () => asked };
    }

    it("after an attempt that never opened, 429 leaves it locked and 403 refused, without retrying", async () => {
      for (const [answer, status] of [
        [429, "locked"],
        [403, "refused"],
      ] as const) {
        const { transport, sockets, scheduler, last } = probed(() => Promise.resolve(answer));
        transport.connect();
        last().drop(1006);
        await flush();
        expect(transport.status).toBe(status);
        scheduler.advance(60_000);
        expect(sockets).toHaveLength(1);
        // «Reintentar» abre otro intento al instante.
        transport.reconnect();
        expect(sockets).toHaveLength(2);
        expect(transport.status).toBe("connecting");
      }
    });

    it("any other answer, or none (a sleeping server does not answer), keeps the backoff", async () => {
      for (const answer of [204, 503, null]) {
        const { transport, sockets, scheduler, last } = probed(() => Promise.resolve(answer));
        transport.connect();
        last().drop(1006);
        await flush();
        expect(transport.status).toBe("connecting");
        scheduler.advance(RETRY_MIN_MS / 2);
        expect(sockets, String(answer)).toHaveLength(2);
      }
    });

    it("a connection that had opened does not ask, and an answer that arrives too late is ignored", async () => {
      const { transport, sockets, scheduler, last, asked } = probed(() => Promise.resolve(429));
      transport.connect();
      last().accept();
      last().drop(1006);
      await flush();
      expect(asked()).toBe(0);
      expect(transport.status).toBe("reconnecting");

      let answer: (status: number) => void = () => undefined;
      const late = probed(() => new Promise((resolve) => (answer = resolve)));
      late.transport.connect();
      late.last().drop(1006);
      late.transport.disconnect();
      answer(429);
      await flush();
      expect(late.transport.status).toBe("idle");
      late.scheduler.advance(60_000);
      expect(late.sockets).toHaveLength(1);
      scheduler.advance(RETRY_MIN_MS);
      expect(sockets).toHaveLength(2);
    });

    it("httpProbe asks GET /ws over https on the same host, and a failure is no answer", async () => {
      const urls: string[] = [];
      const ok = httpProbe("wss://sk.example/ws", (input) => {
        urls.push(input instanceof Request ? input.url : input.toString());
        return Promise.resolve(new Response(null, { status: 429 }));
      });
      expect(await ok()).toBe(429);
      expect(urls).toEqual(["https://sk.example/ws"]);
      const down = httpProbe("ws://127.0.0.1:5173/ws", () => Promise.reject(new TypeError("down")));
      expect(await down()).toBeNull();
    });
  });

  describe("T-39.13 the key is checked over HTTP before any WebSocket", () => {
    const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    function gated(answer: (key: string | null) => Promise<number | null>) {
      const sockets: FakeSocket[] = [];
      const scheduler = new FakeScheduler();
      const asked: (string | null)[] = [];
      let key: string | null = null;
      const transport = createWsTransport({
        url: "wss://example.test/ws",
        open: () => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket;
        },
        scheduler,
        random: () => 0,
        window: null,
        document: null,
        access: (offered) => {
          asked.push(offered);
          return answer(offered);
        },
        accessKey: () => key,
      });
      const setKey = (next: string | null) => {
        key = next;
      };
      return { transport, sockets, scheduler, asked, setKey };
    }

    it("204 opens the WebSocket, and 404 (a server without POST /access) too; each attempt checks the saved key of that moment", async () => {
      for (const answer of [204, 404]) {
        const { transport, sockets, asked, setKey } = gated(() => Promise.resolve(answer));
        setKey("ABCDEFGHJKMNPQRS");
        transport.connect();
        expect(sockets).toHaveLength(0);
        await flush();
        expect(sockets, String(answer)).toHaveLength(1);
        expect(asked).toEqual(["ABCDEFGHJKMNPQRS"]);
        setKey(null);
        transport.reconnect();
        await flush();
        expect(asked).toEqual(["ABCDEFGHJKMNPQRS", null]);
        expect(sockets).toHaveLength(2);
      }
    });

    it("401 leaves it denied, 429 locked and 403 refused, without opening any WebSocket or retrying", async () => {
      for (const [answer, status] of [
        [401, "denied"],
        [429, "locked"],
        [403, "refused"],
      ] as const) {
        const { transport, sockets, scheduler } = gated(() => Promise.resolve(answer));
        transport.connect();
        await flush();
        expect(transport.status).toBe(status);
        scheduler.advance(60_000);
        await flush();
        expect(sockets, String(answer)).toHaveLength(0);
      }
    });

    it("no answer (a sleeping server) or another one keeps the backoff without opening, and opens once it answers 204", async () => {
      let answer: number | null = null;
      const { transport, sockets, scheduler, asked } = gated(() => Promise.resolve(answer));
      transport.connect();
      await flush();
      expect(sockets).toHaveLength(0);
      expect(transport.status).toBe("connecting");
      answer = 503;
      scheduler.advance(RETRY_MIN_MS / 2);
      await flush();
      expect(sockets).toHaveLength(0);
      answer = 204;
      scheduler.advance(RETRY_MIN_MS);
      await flush();
      expect(asked).toHaveLength(3);
      expect(sockets).toHaveLength(1);
      scheduler.advance(UNAVAILABLE_AFTER_MS);
      expect(transport.status).toBe("unavailable");
    });

    it("an answer that arrives after disconnect() or a newer attempt is ignored", async () => {
      const answers: ((status: number) => void)[] = [];
      const { transport, sockets } = gated(() => new Promise((resolve) => answers.push(resolve)));
      transport.connect();
      transport.disconnect();
      answers[0]?.(204);
      await flush();
      expect(sockets).toHaveLength(0);
      expect(transport.status).toBe("idle");
      transport.connect();
      transport.reconnect();
      answers[1]?.(401);
      await flush();
      expect(transport.status).toBe("connecting");
      answers[2]?.(204);
      await flush();
      expect(sockets).toHaveLength(1);
    });

    it("httpAccess posts to /access on the same host with the key in a header, never in the URL", async () => {
      const calls: { url: string; init: RequestInit | undefined }[] = [];
      const check = httpAccess("wss://sk.example/ws", (input, init) => {
        calls.push({ url: input instanceof Request ? input.url : input.toString(), init });
        return Promise.resolve(new Response(null, { status: 401 }));
      });
      expect(await check("abcd-efgh-jkmn-pqrs")).toBe(401);
      expect(await check(null)).toBe(401);
      expect(calls.map((c) => c.url)).toEqual([
        "https://sk.example/access",
        "https://sk.example/access",
      ]);
      expect(calls[0]?.init?.method).toBe("POST");
      expect(calls[0]?.init?.headers).toEqual({
        [ACCESS_KEY_HEADER]: encodeAccessKey("ABCDEFGHJKMNPQRS"),
      });
      expect(calls[1]?.init?.headers).toEqual({});
      for (const { url } of calls) expect(url).not.toMatch(/ABCD|QUJD/);
      const down = httpAccess("ws://127.0.0.1:5173/ws", () =>
        Promise.reject(new TypeError("down")),
      );
      expect(await down("ABCDEFGHJKMNPQRS")).toBeNull();
    });
  });

  it("«Jugar en esta pestaña»: reconnect() opens a new socket at once after 4001", () => {
    const { transport, sockets, last } = setup();
    transport.connect();
    last().accept();
    last().drop(4001);
    transport.reconnect();
    expect(sockets).toHaveLength(2);
    expect(transport.status).toBe("connecting");
    last().accept();
    expect(transport.status).toBe("open");
  });

  it("reconnect() on an open socket replaces it without waiting (pong watchdog)", () => {
    const { transport, sockets, last } = setup();
    transport.connect();
    const first = last();
    first.accept();
    transport.reconnect();
    expect(first.closedWith).toBe(1000);
    expect(sockets).toHaveLength(2);
    expect(transport.status).toBe("reconnecting");
    // El cierre tardío del socket viejo no cambia nada.
    first.drop(1006);
    expect(transport.status).toBe("reconnecting");
    last().accept();
    expect(transport.status).toBe("open");
  });

  it("disconnect() stops retrying and leaves it idle", () => {
    const { transport, sockets, scheduler, last } = setup();
    transport.connect();
    last().accept();
    last().drop(1006);
    transport.disconnect();
    expect(transport.status).toBe("idle");
    scheduler.advance(60_000);
    expect(sockets).toHaveLength(1);
  });

  describe("immediate reconnection on mobile", () => {
    it("reconnects at once when the page becomes visible again", () => {
      const { transport, sockets, doc, last } = setup();
      transport.connect();
      last().accept();
      last().drop(1006);
      doc.visibilityState = "hidden";
      doc.dispatchEvent(new Event("visibilitychange"));
      expect(sockets).toHaveLength(1);
      doc.visibilityState = "visible";
      doc.dispatchEvent(new Event("visibilitychange"));
      expect(sockets).toHaveLength(2);
      last().accept();
      expect(transport.status).toBe("open");
    });

    it("reconnects at once when the page is restored from the cache (pageshow, persisted)", () => {
      const { transport, sockets, win, last } = setup();
      transport.connect();
      last().accept();
      last().drop(1006);
      win.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false }));
      expect(sockets).toHaveLength(1);
      win.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
      expect(sockets).toHaveLength(2);
    });

    it("reconnects at once when the network comes back, even in the middle of the backoff", () => {
      const { transport, sockets, scheduler, win, last } = setup({ random: () => 0.999_999 });
      transport.connect();
      last().accept();
      last().drop(1006);
      for (let i = 0; i < 4; i++) {
        scheduler.advance(RETRY_MAX_MS);
        last().drop(1006);
      }
      const before = sockets.length;
      win.dispatchEvent(new Event("online"));
      expect(sockets.length).toBe(before + 1);
      last().accept();
      // La espera vuelve al mínimo.
      last().drop(1006);
      const after = sockets.length;
      scheduler.advance(RETRY_MIN_MS);
      expect(sockets.length).toBe(after + 1);
    });

    it("does nothing when the socket is open, after disconnect() or after close()", () => {
      const { transport, sockets, win, doc, last } = setup();
      transport.connect();
      last().accept();
      win.dispatchEvent(new Event("online"));
      doc.dispatchEvent(new Event("visibilitychange"));
      expect(sockets).toHaveLength(1);
      transport.disconnect();
      win.dispatchEvent(new Event("online"));
      expect(sockets).toHaveLength(1);
      transport.connect();
      last().accept();
      last().drop(1006);
      transport.close();
      win.dispatchEvent(new Event("online"));
      win.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
      expect(sockets).toHaveLength(2);
    });

    it("does not wake a replaced or incompatible session", () => {
      const { transport, sockets, win, last } = setup();
      transport.connect();
      last().accept();
      last().drop(4001);
      win.dispatchEvent(new Event("online"));
      expect(sockets).toHaveLength(1);
      expect(transport.status).toBe("replaced");
    });
  });
});
