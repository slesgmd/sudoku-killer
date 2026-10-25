// T-32.1 (I, F9): para partidas aleatorias contra el servidor real (aciertos, errores, pistas, notas,
// deshacer, ajustes, presencia, entradas, salidas, caídas, vueltas con ficha y avances del reloj),
// `replay(registro)` da el mismo estado que el servidor en vivo: tablero, notas, vidas, puntajes,
// roles, conexiones y ranking. El registro es el que confirmó el `MatchRepository`.
// Cualquiera, también quien creó la sala, puede salir, caerse y volver. Si no queda nadie conectado
// y pasan 120 s, la sala se borra (R-14): la propiedad lo comprueba y termina esa ejecución.
import fc from "fast-check";
import { replay } from "@sudoku-killer/game";
import type { PublicPuzzle } from "@sudoku-killer/protocol";
import { beforeAll, describe, expect, it } from "vitest";
import { answer, emptyCells, started, wrong } from "./helpers/play.ts";
import { assertAsyncProperty } from "./helpers/property.ts";
import { GRACE_MS } from "../src/rooms/limits.ts";
import { createTestServer, errorOf, mode, testBank, type TestClient } from "./helpers/server.ts";

const PLAYERS = 3;

/**
 * El actor de un comando, entre los jugadores conectados (o, para `back`, entre los que están
 * fuera): `who % cantidad`. Los rangos son los de siempre para que las semillas registradas sigan
 * generando las mismas acciones.
 */
const who = fc.nat(PLAYERS - 1);
const other = fc.integer({ min: 1, max: PLAYERS });
const actionArb = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant("place" as const),
      who,
      pick: fc.nat(),
      correct: fc.boolean(),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("hint" as const), who, pick: fc.nat() }) },
  {
    weight: 5,
    arbitrary: fc.record({
      kind: fc.constant("note" as const),
      who,
      add: fc.boolean(),
      group: fc.boolean(),
      pick: fc.nat(),
      digit: fc.integer({ min: 1, max: 9 }),
    }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("undo" as const), who, back: fc.nat(3) }) },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant("settings" as const), who, on: fc.boolean() }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant("presence" as const), who, pick: fc.nat() }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("leave" as const), who: other }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("drop" as const), who: other }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("back" as const), who: other }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("newcomer" as const) }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("wait" as const),
      ms: fc.integer({ min: 0, max: 130_000 }),
    }),
  },
);

/** El elemento `who % length` de una lista, o `undefined` si está vacía. */
function pickOf<T>(list: readonly T[], who: number): T | undefined {
  return list.length === 0 ? undefined : list[who % list.length];
}

interface Seat {
  client: TestClient;
  readonly nickname: string;
  token: string | null;
  inside: boolean;
  readonly ops: number[];
}

beforeAll(async () => {
  await testBank();
}, 60_000);

type Harness = Awaited<ReturnType<typeof createTestServer>>;

/**
 * La sala se borró (R-14): nadie puede volver con su ficha (`room.not_found`) y el registro,
 * reproducido, termina en derrota con todos fuera.
 */
async function expectDeleted(
  h: Harness,
  code: string,
  matchId: string,
  puzzle: PublicPuzzle,
  back: { readonly nickname: string; readonly token: string },
): Promise<void> {
  expect(h.server.rooms.has(code)).toBe(false);
  expect(errorOf(await h.client().join(code, back.nickname, back.token))).toBe("room.not_found");
  const events = await h.repository.events(matchId);
  expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
  const replayed = replay(events, { mode, puzzle });
  expect(replayed.result).toBe("defeat");
  for (const p of replayed.players.values()) expect(["left", "expired"]).toContain(p.connection);
}

/** El registro reproducido da el estado en vivo y el mismo ranking. */
async function expectReplayEqualsLive(h: Harness, code: string, matchId: string): Promise<void> {
  const match = h.room(code).match;
  if (!match) throw new Error("No match");
  const events = await h.repository.events(matchId);
  expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
  const replayed = replay(events, { mode, puzzle: match.puzzle });
  expect(replayed).toEqual(match.state);
  expect(mode.ranking(replayed)).toEqual(mode.ranking(match.state));
}

// Casos fijos, independientes de fast-check (docs/motor.md, «Pruebas aleatorias y semillas»): la
// regresión de la semilla -1802840427 deja de depender de `seed` y `path` si cambian los arbitrarios.
describe("R-32 reproducible log: fixed cases", () => {
  it("T-32.1 players 1, 2 and 0 drop and 120 s pass: the room is deleted, room.not_found and defeat in the log", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Jugador 0", "Jugador 1", "Jugador 2"]);
    const [p0, p1, p2] = clients;
    if (!p0?.token || !p1 || !p2) throw new Error();
    const match = h.room(code).match;
    if (!match) throw new Error();
    for (const client of [p1, p2, p0]) await client.drop();
    await h.advance(GRACE_MS - 1);
    expect(h.server.rooms.has(code)).toBe(true);
    await h.advance(1);
    await h.settle();
    await expectDeleted(h, code, match.state.id, match.puzzle, {
      nickname: "Jugador 0",
      token: p0.token,
    });
  });

  it("T-32.1 players 1 and 2 drop and 130 s pass with player 0 connected: the room stays and replay equals live", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Jugador 0", "Jugador 1", "Jugador 2"]);
    const [p0, p1, p2] = clients;
    if (!p0 || !p1 || !p2) throw new Error();
    const matchId = h.room(code).match?.state.id ?? "";
    for (const client of [p1, p2]) await client.drop();
    await h.advance(130_000);
    await h.settle();
    expect(h.server.rooms.has(code)).toBe(true);
    expect(h.room(code).state).toBe("running");
    await expectReplayEqualsLive(h, code, matchId);
    const players = h.room(code).match?.state.players;
    expect(players?.get(p0.playerId ?? "")?.connection).toBe("connected");
    expect(players?.get(p1.playerId ?? "")?.connection).toBe("expired");
  });
});

describe("R-32 reproducible log", () => {
  it("T-32.1 replay(log) equals the live server state", { timeout: 180_000 }, async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        fc.nat(1_000_000),
        fc.array(actionArb, { minLength: 5, maxLength: 40 }),
        async (seed, actions) => {
          const h = await createTestServer({ seed });
          const nicknames = Array.from({ length: PLAYERS }, (_, i) => `Jugador ${String(i)}`);
          const { code, clients } = await started(h, nicknames);
          const seats: Seat[] = clients.map((client, i) => ({
            client,
            nickname: nicknames[i] ?? "",
            token: client.token,
            inside: true,
            ops: [],
          }));
          const matchId = h.room(code).match?.state.id ?? "";
          const puzzle = h.room(code).match?.puzzle;
          if (!puzzle) throw new Error("No match");
          /** Desde cuándo no queda nadie conectado (hora del reloj falso), o `null`. */
          let emptySince: number | null = null;
          /** La sala se borró (R-14): nadie puede volver y el registro termina en derrota. */
          const deleted = async () => {
            const back = seats.find((s) => s.token !== null);
            if (!back?.token) throw new Error("No token");
            await expectDeleted(h, code, matchId, puzzle, {
              nickname: back.nickname,
              token: back.token,
            });
          };
          const cellOf = (pick: number, onlyEmpty: boolean) => {
            const pool = onlyEmpty ? emptyCells(h, code) : Array.from({ length: 81 }, (_, i) => i);
            return pool[pick % Math.max(1, pool.length)] ?? 0;
          };

          for (const action of actions) {
            if (h.room(code).state !== "running") break;
            const inside = seats.filter((s) => s.inside);
            const seat =
              action.kind === "back"
                ? pickOf(
                    seats.filter((s) => !s.inside),
                    action.who,
                  )
                : "who" in action
                  ? pickOf(inside, action.who)
                  : undefined;
            const client = seat?.inside ? seat.client : undefined;
            switch (action.kind) {
              case "place": {
                const cell = cellOf(action.pick, action.correct);
                const digit = action.correct ? answer(h, code, cell) : wrong(h, code, cell);
                await client?.send("cell.place", { cell, digit });
                break;
              }
              case "hint":
                await client?.send("hint.use", { cell: cellOf(action.pick, true) });
                break;
              case "note": {
                const replies = await client?.send(action.add ? "note.add" : "note.remove", {
                  layer: action.group ? "group" : "personal",
                  cell: cellOf(action.pick, true),
                  digit: action.digit,
                });
                const applied = replies?.find((m) => m.type === "note.applied");
                if (seat && applied?.type === "note.applied") seat.ops.push(applied.payload.opSeq);
                break;
              }
              case "undo": {
                const ops = seat?.ops ?? [];
                const opSeq = ops[ops.length - 1 - (action.back % Math.max(1, ops.length))] ?? 1;
                await client?.send("note.undo", { opSeq });
                break;
              }
              case "settings":
                await client?.send("settings.update", { autoCleanPersonalNotes: action.on });
                break;
              case "presence":
                await client?.send("presence.select", { cell: cellOf(action.pick, false) });
                break;
              case "leave":
                if (client && seat) {
                  await client.send("room.leave", {});
                  seat.inside = false;
                }
                break;
              case "drop":
                if (client && seat) {
                  await client.drop();
                  seat.inside = false;
                }
                break;
              case "back":
                if (seat && !seat.inside && seat.token) {
                  const next = h.client();
                  const replies = await next.join(code, seat.nickname, seat.token);
                  if (replies.some((m) => m.type === "room.welcome")) {
                    seat.client = next;
                    seat.inside = true;
                  }
                }
                break;
              case "newcomer": {
                const nickname = `Nuevo ${String(seats.length)}`;
                const next = h.client();
                const replies = await next.join(code, nickname);
                if (replies.some((m) => m.type === "room.welcome")) {
                  seats.push({ client: next, nickname, token: next.token, inside: true, ops: [] });
                }
                break;
              }
              case "wait":
                await h.advance(action.ms);
                break;
            }
            if (seats.some((s) => s.inside)) emptySince = null;
            else emptySince ??= h.clock.now();
            if (emptySince !== null && h.clock.now() - emptySince >= GRACE_MS) {
              await h.settle();
              await deleted();
              return;
            }
          }
          await h.settle();
          await expectReplayEqualsLive(h, code, matchId);
        },
      ),
      {
        numRuns: 40,
        // Los jugadores 1, 2 y 0 se caen y pasan 120 s: la sala se borra (R-14). Antes el arnés
        // lo tomaba por un fallo; el `path` reproduce ese contraejemplo reducido. El mismo caso, sin
        // fast-check, está en «fixed cases».
        regressions: [
          {
            seed: -1802840427,
            path: "14:2:4:9:17:14:11:13:13:13:13:13:13:13:13:13:13:13:13:13",
          },
        ],
      },
    );
  });
});
