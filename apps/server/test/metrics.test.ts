// Métricas básicas (F12h): cada 60 s, una línea `metrics` con recuentos y tiempos del servidor real
// (conexiones, direcciones, salas, partidas, jugadores conectados, escrituras en la base, bucle de
// eventos, memoria y claves rechazadas), sin códigos de sala, apodos, fichas ni direcciones IP.
import { accessProtocols } from "@sudoku-killer/protocol";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createLogger } from "../src/log/logger.ts";
import { startMetrics } from "../src/log/metrics.ts";
import { testBank } from "./helpers/server.ts";
import { TEST_ORIGIN, startWsServer, type RunningWsServer } from "./helpers/ws-server.ts";

let running: RunningWsServer | null = null;

beforeAll(async () => {
  await testBank();
}, 60_000);

afterEach(async () => {
  await running?.stop();
  running = null;
});

function open(r: RunningWsServer, protocols: readonly string[] = []): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${String(r.port)}/ws`, [...protocols], {
      origin: TEST_ORIGIN,
    });
    ws.on("open", () => {
      resolve(ws);
    });
    ws.on("error", reject);
  });
}

function next(ws: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const listener = (data: Buffer) => {
      const message = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
      if (message["type"] !== type) return;
      ws.off("message", listener);
      resolve(message);
    };
    ws.on("message", listener);
  });
}

describe("F12h metrics", () => {
  it("logs counts and timings every interval, and nothing about the people", async () => {
    const KEY = "ABCD-EFGH-JKMN-PQRS";
    running = await startWsServer({ accessKey: KEY });
    const r = running;
    const lines: string[] = [];
    const stop = startMetrics({
      sources: { transport: r.transport, rooms: r.server.rooms, writer: r.sink, access: r.access },
      clock: r.clock,
      logger: createLogger({ write: (line) => lines.push(line) }),
      // Menos que el heartbeat (15 s): el reloj falso no espera los pong.
      intervalMs: 10_000,
      memory: () => ({ rss: 200 * 1024 * 1024, heapUsed: 50 * 1024 * 1024 }),
    });
    try {
      const ana = await open(r, accessProtocols(KEY));
      ana.send(
        JSON.stringify({ v: 1, id: "a1", type: "room.create", payload: { nickname: "Anacleta" } }),
      );
      const welcome = await next(ana, "room.welcome");
      const code = /"code":"([A-Z0-9]{6})"/.exec(JSON.stringify(welcome))?.[1] ?? "";
      expect(code).toHaveLength(6);
      await new Promise<void>((resolve) => {
        const denied = new WebSocket(`ws://127.0.0.1:${String(r.port)}/ws`, {
          origin: TEST_ORIGIN,
        });
        denied.on("close", () => {
          resolve();
        });
      });

      await r.clock.advance(9_999, () => new Promise<void>((resolve) => setImmediate(resolve)));
      expect(lines).toEqual([]);
      await r.clock.advance(1, () => new Promise<void>((resolve) => setImmediate(resolve)));
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
      expect(entry).toMatchObject({
        level: "info",
        message: "metrics",
        uptimeS: 10,
        connections: 1,
        addresses: 1,
        rooms: 1,
        matchesRunning: 0,
        playersConnected: 1,
        rssMb: 200,
        heapUsedMb: 50,
        accessDenied: 1,
      });
      for (const field of ["commits", "events", "commitP95Ms", "commitMaxMs", "eventLoopP95Ms"])
        expect(typeof entry[field], field).toBe("number");
      for (const secret of ["Anacleta", code, "127.0.0.1", "ABCD", "token"])
        expect(lines[0], secret).not.toContain(secret);

      // El período siguiente empieza de cero: ningún rechazo nuevo.
      await r.clock.advance(10_000, () => new Promise<void>((resolve) => setImmediate(resolve)));
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[1] ?? "{}")).toMatchObject({ accessDenied: 0 });
      ana.close();
    } finally {
      stop();
    }
  });
});
