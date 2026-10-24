// T-32.1 (I, F9): para partidas aleatorias contra el servidor real (aciertos, errores, pistas, notas,
// deshacer, ajustes, presencia, entradas, salidas, caídas, vueltas con ficha y avances del reloj),
// `replay(registro)` da el mismo estado que el servidor en vivo: tablero, notas, vidas, puntajes,
// roles, conexiones y ranking. El registro es el que confirmó el `MatchRepository`.
import fc from "fast-check";
import { replay } from "@sudoku-killer/game";
import { beforeAll, describe, expect, it } from "vitest";
import { answer, emptyCells, started, wrong } from "./helpers/play.ts";
import { assertAsyncProperty } from "./helpers/property.ts";
import { createTestServer, mode, testBank, type TestClient } from "./helpers/server.ts";

const PLAYERS = 3;

const who = fc.nat(PLAYERS - 1);
/** Quien no es el jugador 0 puede salir, caerse y volver: el 0 mantiene viva la sala. */
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
          const cellOf = (pick: number, onlyEmpty: boolean) => {
            const pool = onlyEmpty ? emptyCells(h, code) : Array.from({ length: 81 }, (_, i) => i);
            return pool[pick % Math.max(1, pool.length)] ?? 0;
          };

          for (const action of actions) {
            if (h.room(code).state !== "running") break;
            const seat = "who" in action ? seats[action.who % seats.length] : undefined;
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
          }
          await h.settle();

          const match = h.room(code).match;
          if (!match) throw new Error("No match");
          const events = await h.repository.events(matchId);
          expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
          const replayed = replay(events, { mode, puzzle: match.puzzle });
          expect(replayed).toEqual(match.state);
          expect(mode.ranking(replayed)).toEqual(mode.ranking(match.state));
        },
      ),
      { numRuns: 40 },
    );
  });
});
