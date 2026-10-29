// El cliente contra el servidor real: `GameClient` + el transporte WebSocket (con la
// implementación de `ws`) frente al servidor de salas sobre `ws`, con PGlite y el inspector de
// filtración (SPEC §8.3) sobre todo lo que reciben los clientes.
// - E-07 y base de T-13.5: la conexión cae con una nota y una jugada en vuelo; el cliente vuelve con
//   su ficha, reenvía lo pendiente con el mismo `id` y no pierde ni duplica nada.
// - E-08: la misma ficha en otra conexión desplaza a la anterior (4001), y «Jugar en esta pestaña»
//   la recupera.
// - E-19: un servidor que cierra con 4000 deja el cliente en `incompatible`, sin reintentar.
import { digitBit, solveA } from "@sudoku-killer/engine";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { testBank } from "../../../server/test/helpers/server.ts";
import {
  TEST_ORIGIN,
  startWsServer,
  type RunningWsServer,
} from "../../../server/test/helpers/ws-server.ts";
import { GameClient } from "../../src/game/client.ts";
import { memoryPrefs } from "../../src/game/prefs.ts";
import { memorySession, type SessionStore } from "../../src/game/session.ts";
import type { ClientState } from "../../src/game/state.ts";
import { createWsTransport, type SocketLike } from "../../src/transport/ws.ts";

const WAIT_MS = 8000;

let running: RunningWsServer | null = null;
const clients: GameClient[] = [];
let socketIds = 0;

beforeAll(async () => {
  await testBank();
}, 60_000);

afterEach(async () => {
  for (const client of clients.splice(0)) client.destroy();
  const current = running;
  running = null;
  if (!current) return;
  await current.stop();
  expect(current.inspector.violations, "leak inspector (SPEC §8.3)").toEqual([]);
  expect(current.inspector.inspected).toBeGreaterThan(0);
});

interface Live {
  readonly client: GameClient;
  /** El socket actual, para cortarlo como lo haría la red. */
  readonly socket: () => WebSocket;
}

function live(r: RunningWsServer, session: SessionStore = memorySession()): Live {
  let current: WebSocket | null = null;
  const transport = createWsTransport({
    url: `ws://127.0.0.1:${String(r.port)}/ws`,
    open: (url) => {
      const id = ++socketIds;
      const ws = new WebSocket(url, { origin: TEST_ORIGIN });
      ws.on("message", (data) => {
        r.inspector.check(id, (data as Buffer).toString("utf8"));
      });
      current = ws;
      return ws as unknown as SocketLike;
    },
    window: null,
    document: null,
  });
  const client = new GameClient({ transport, prefs: memoryPrefs(), session });
  clients.push(client);
  return {
    client,
    socket: () => {
      if (!current) throw new Error("No socket");
      return current;
    },
  };
}

function until(client: GameClient, test: (state: ClientState) => boolean, what: string) {
  return new Promise<ClientState>((resolve, reject) => {
    if (test(client.getState())) {
      resolve(client.getState());
      return;
    }
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${what}`));
    }, WAIT_MS);
    const unsubscribe = client.subscribe(() => {
      if (!test(client.getState())) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(client.getState());
    });
  });
}

/** Inés crea la sala e inicia una partida fácil; devuelve el código y la solución. */
async function started(r: RunningWsServer, ines: Live) {
  ines.client.start("Inés", "easy");
  const state = await until(ines.client, (s) => s.phase === "playing", "the match to start");
  const puzzle = state.match?.puzzle;
  const code = state.room?.code;
  if (!puzzle || !code) throw new Error("No match");
  const solution = solveA(puzzle, { limit: 1 }).solutions[0];
  if (!solution) throw new Error("No solution");
  expect(r.solutions.some((s) => s.join("") === solution.join(""))).toBe(true);
  return { code, puzzle, solution };
}

function emptyCells(state: ClientState): number[] {
  return state.locked.flatMap((cell, index) => (cell === null ? [index] : []));
}

describe("client against the real server (F10)", () => {
  it("E-07: the connection drops with a note and a move in flight; nothing is lost or doubled", async () => {
    const r = await startWsServer();
    running = r;
    const ines = live(r);
    const { code, solution } = await started(r, ines);
    const tomas = live(r);
    tomas.client.join(code, "Tomás");
    await until(tomas.client, (s) => s.phase === "playing", "Tomás in the match");

    const [noteCell, groupCell, moveCell] = emptyCells(ines.client.getState());
    if (noteCell === undefined || groupCell === undefined || moveCell === undefined) {
      throw new Error("No empty cells");
    }
    // Dígitos de notas distintos del de la jugada, para que la limpieza automática no los quite.
    const [d1, d2, d3] = [1, 2, 3, 4].filter((d) => d !== solution[moveCell]);
    if (d1 === undefined || d2 === undefined || d3 === undefined) throw new Error("No digits");
    // Una nota personal y una grupal confirmadas antes del corte.
    ines.client.setMode("notes");
    ines.client.select(noteCell);
    ines.client.input(d1);
    ines.client.setLayer("group");
    ines.client.select(groupCell);
    ines.client.input(d2);
    await until(ines.client, (s) => s.pendingNotes.length === 0, "the notes to be confirmed");

    // Una jugada correcta en vuelo y la red se corta.
    ines.client.setMode("number");
    ines.client.select(moveCell);
    ines.client.input(solution[moveCell] ?? 0);
    ines.socket().terminate();
    await until(ines.client, (s) => s.connection !== "open", "the drop to be noticed");
    // Sin conexión: los números se bloquean y las notas se encolan.
    expect(ines.client.canPlace()).toBe(false);
    ines.client.setMode("notes");
    ines.client.setLayer("personal");
    ines.client.select(noteCell);
    ines.client.input(d3);
    expect(ines.client.getState().pendingNotes).toHaveLength(1);

    const back = await until(
      ines.client,
      (s) => s.connection === "open" && s.pendingNotes.length === 0 && s.pending.size === 0,
      "the return with the token",
    );
    const me = back.players.find((p) => p.id === back.playerId);
    expect(me?.connection).toBe("connected");
    expect(me?.lives).toBe(3);
    expect(back.locked[moveCell]).toMatchObject({ value: solution[moveCell], by: back.playerId });
    expect(back.personalNotes[noteCell]).toBe(digitBit(d1) | digitBit(d3));
    expect(back.groupNotes[groupCell]).toBe(digitBit(d2));

    // El servidor aplicó la jugada una sola vez y el puntaje coincide.
    const room = r.server.rooms.get(code);
    const match = room?.match?.state;
    expect(match?.cells[moveCell]).toMatchObject({ status: "locked", by: back.playerId });
    const serverMe = back.playerId === null ? undefined : match?.players.get(back.playerId);
    expect(me?.score).toBe(serverMe?.score);
    expect(serverMe?.mistakes).toBe(0);
    // Tomás ve lo mismo.
    const seen = await until(
      tomas.client,
      (s) => s.locked[moveCell] !== null && s.groupNotes[groupCell] === digitBit(d2),
      "Tomás to see the move",
    );
    expect(seen.locked[moveCell]?.value).toBe(solution[moveCell]);
    // Las notas personales de Inés nunca le llegan a Tomás.
    expect(seen.personalNotes[noteCell]).toBe(0);
  });

  it("E-08: the same token in another connection replaces the first one (4001)", async () => {
    const r = await startWsServer();
    running = r;
    const session = memorySession();
    const first = live(r, session);
    const { code } = await started(r, first);
    // Otra pestaña del mismo navegador (la misma sesión) vuelve con la ficha.
    const second = live(r, session);
    second.client.resume(code);
    await until(second.client, (s) => s.phase === "playing", "the second tab");
    await until(first.client, (s) => s.connection === "replaced", "the first tab to be replaced");
    expect(first.client.getState().players.find((p) => p.nickname === "Inés")).toBeDefined();
    // «Jugar en esta pestaña».
    first.client.playHere();
    await until(first.client, (s) => s.connection === "open", "the first tab to come back");
    await until(second.client, (s) => s.connection === "replaced", "the second tab to be replaced");
    expect(r.server.rooms.get(code)?.match?.state.players.size).toBe(1);
  });

  it("E-19: a server that closes with 4000 leaves the client incompatible, without retrying", async () => {
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    let connections = 0;
    wss.on("connection", (ws) => {
      connections++;
      ws.on("message", () => {
        ws.close(4000, "protocol.unsupported");
      });
    });
    await new Promise<void>((resolve) => {
      wss.on("listening", resolve);
    });
    const address = wss.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    const transport = createWsTransport({
      url: `ws://127.0.0.1:${String(port)}`,
      open: (url) => new WebSocket(url) as unknown as SocketLike,
      window: null,
      document: null,
    });
    const client = new GameClient({ transport, prefs: memoryPrefs(), session: memorySession() });
    clients.push(client);
    client.create("Inés");
    await until(client, (s) => s.connection === "incompatible", "the version close");
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(connections).toBe(1);
    await new Promise<void>((resolve) => {
      wss.close(() => {
        resolve();
      });
    });
  });
});
