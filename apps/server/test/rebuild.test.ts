// Equivalencia de la reconstrucción (F11d; T-32.1, E-07 y E-15): una partida aleatoria contra el
// servidor real (aciertos, errores, pistas, notas personales y grupales, deshacer, caídas y vueltas
// con ficha, avances del reloj) con un reinicio del servidor en un punto al azar. Al final:
// - el estado de la sala es igual a `replay(registro)`;
// - cada comando que dejó un evento, reenviado con su `id` original, recibe exactamente las
//   respuestas que recibió la primera vez (la caché de idempotencia, repoblada desde el registro
//   para los de antes del reinicio), y no se vuelve a aplicar: el registro y el estado no cambian.
// Los comandos rechazados (con `error`) o sin efecto (`ack { applied: false }`) no se guardan en el
// registro: tras el reinicio se volverían a
// evaluar (SPEC §4.6), así que no se reenvían. Cada jugador queda por debajo de las 256 entradas de la caché.
// Verificación negativa: con `SK_REBUILD_BREAK=log`, antes del reinicio se altera el `clientMsgId`
// del último evento con autor en la base, y la prueba tiene que fallar.
import fc from "fast-check";
import type { ClientMessageType, ServerEnvelope } from "@sudoku-killer/protocol";
import { beforeAll, describe, expect, it } from "vitest";
import { answer, emptyCells, started, wrong } from "./helpers/play.ts";
import { assertAsyncProperty } from "./helpers/property.ts";
import { createTestServer, mode, testBank, type TestClient } from "./helpers/server.ts";
import { replay } from "@sudoku-killer/game";

const PLAYERS = 3;
const BREAK_LOG = process.env["SK_REBUILD_BREAK"] === "log";

const who = fc.nat(PLAYERS - 1);
const actionArb = fc.oneof(
  {
    weight: 4,
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
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("undo" as const), who }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("drop" as const), who }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("back" as const), who }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("wait" as const),
      ms: fc.integer({ min: 0, max: 30_000 }),
    }),
  },
);

interface Seat {
  client: TestClient;
  readonly nickname: string;
  readonly token: string;
  inside: boolean;
  readonly ops: number[];
}

/** Un comando enviado, con lo que respondió el servidor la primera vez. */
interface Sent {
  readonly seat: Seat;
  readonly type: ClientMessageType;
  readonly payload: object;
  readonly id: string;
  readonly replies: readonly ServerEnvelope[];
}

/** Comandos de antes del reinicio cuyas respuestas se compararon, en todas las ejecuciones. */
let comparedBeforeRestart = 0;

beforeAll(async () => {
  await testBank();
}, 60_000);

describe("F11d the rebuild is equivalent to the live match", () => {
  it(
    "T-32.1 E-07 E-15 after a restart mid-match, the room equals replay(log) and every applied command gets its original replies again",
    { timeout: 240_000 },
    async () => {
      await assertAsyncProperty(
        fc.asyncProperty(
          fc.nat(1_000_000),
          fc.array(actionArb, { minLength: 10, maxLength: 50 }),
          fc.nat(),
          async (seed, actions, restartPick) => {
            const h = await createTestServer({ seed });
            const nicknames = Array.from({ length: PLAYERS }, (_, i) => `Jugador ${String(i)}`);
            const { code, clients } = await started(h, nicknames);
            const seats: Seat[] = clients.map((client, i) => ({
              client,
              nickname: nicknames[i] ?? "",
              token: client.token ?? "",
              inside: true,
              ops: [],
            }));
            const matchId = h.room(code).match?.state.id ?? "";
            const restartAt = restartPick % (actions.length + 1);
            let beforeRestart = 0;
            const sent: Sent[] = [];
            let restarted = false;
            const running = () => h.server.rooms.get(code)?.match?.state.endedAt === null;
            const cellOf = (pick: number) => {
              const pool = emptyCells(h, code);
              return pool[pick % Math.max(1, pool.length)] ?? 0;
            };
            let nextId = 1;
            const command = async (seat: Seat, type: ClientMessageType, payload: object) => {
              const id = `f11d-${String(nextId++)}`;
              const replies = await seat.client.send(type, payload as never, id);
              sent.push({ seat, type, payload, id, replies });
              return replies;
            };
            const rejoin = async (seat: Seat) => {
              const next = h.client();
              const replies = await next.join(code, seat.nickname, seat.token);
              if (!replies.some((m) => m.type === "room.welcome")) throw new Error("Not back");
              seat.client = next;
              seat.inside = true;
            };

            for (const [index, action] of actions.entries()) {
              if (!running()) break;
              if (index === restartAt) {
                if (BREAK_LOG) await tamperLastAuthoredEvent(matchId);
                await h.restart();
                restarted = true;
                beforeRestart = sent.length;
                // Tras el reinicio, todos están fuera con un plazo nuevo; vuelven quienes estaban.
                for (const seat of seats) if (seat.inside) await rejoin(seat);
              }
              const seat = seats[action.kind === "wait" ? 0 : action.who];
              if (!seat) continue;
              switch (action.kind) {
                case "place": {
                  if (!seat.inside) break;
                  const cell = cellOf(action.pick);
                  const digit = action.correct ? answer(h, code, cell) : wrong(h, code, cell);
                  await command(seat, "cell.place", { cell, digit });
                  break;
                }
                case "hint":
                  if (seat.inside) await command(seat, "hint.use", { cell: cellOf(action.pick) });
                  break;
                case "note": {
                  if (!seat.inside) break;
                  const replies = await command(seat, action.add ? "note.add" : "note.remove", {
                    layer: action.group ? "group" : "personal",
                    cell: cellOf(action.pick),
                    digit: action.digit,
                  });
                  const applied = replies.find((m) => m.type === "note.applied");
                  if (applied?.type === "note.applied") seat.ops.push(applied.payload.opSeq);
                  break;
                }
                case "undo": {
                  const opSeq = seat.ops.at(-1);
                  if (seat.inside && opSeq !== undefined)
                    await command(seat, "note.undo", { opSeq });
                  break;
                }
                case "drop":
                  // Siempre queda alguien conectado: la sala no se borra (eso lo cubre T-32.1).
                  if (seat.inside && seats.filter((s) => s.inside).length > 1) {
                    await seat.client.drop();
                    seat.inside = false;
                  }
                  break;
                case "back":
                  if (!seat.inside) await rejoin(seat);
                  break;
                case "wait":
                  await h.advance(action.ms);
                  break;
              }
            }
            // Una partida que terminó antes del reinicio no se reconstruye: no prueba nada aquí.
            if (!running() || !restarted) return;
            await h.settle();

            const match = h.room(code).match;
            if (!match) throw new Error("No match");
            const events = await h.repository.events(matchId);
            expect(replay(events, { mode, puzzle: match.puzzle })).toEqual(match.state);

            // Cada comando que dejó un evento, otra vez con su `id`: las mismas respuestas y nada
            // nuevo en el registro ni en el estado.
            const logged = new Set(
              events.flatMap((e) => ("clientMsgId" in e.payload ? [e.payload.clientMsgId] : [])),
            );
            const before = match.state;
            for (const seat of seats) if (!seat.inside) await rejoin(seat);
            for (const [index, command] of sent.entries()) {
              // Aplicado: respondido sin error y sin `ack { applied: false }` (una nota que no cambió
              // nada). Tiene que estar en el registro con su `id`.
              const rejected = command.replies.some(
                (m) => m.type === "error" || (m.type === "ack" && !m.payload.applied),
              );
              if (command.replies.length === 0 || rejected) continue;
              expect(logged.has(command.id), `${command.type} ${command.id} in the log`).toBe(true);
              if (index < beforeRestart) comparedBeforeRestart++;
              const { client } = command.seat;
              const mark = client.mark();
              client.post(command.type, command.payload as never, command.id);
              await h.settle();
              const again = client.since(mark).filter((m) => m.replyTo === command.id);
              expect(again, `${command.type} ${command.id}`).toEqual(command.replies);
            }
            await h.settle();
            const after = await h.repository.events(matchId);
            expect(after.filter((e) => e.type !== "player.connection")).toEqual(
              events.filter((e) => e.type !== "player.connection"),
            );
            const live = h.room(code).match?.state;
            expect(live?.cells).toEqual(before.cells);
            expect(live?.groupNotes).toEqual(before.groupNotes);
            expect(
              [...(live?.players.values() ?? [])].map((p) => [p.lives, p.score, p.mistakes]),
            ).toEqual([...before.players.values()].map((p) => [p.lives, p.score, p.mistakes]));
            expect(replay(after, { mode, puzzle: match.puzzle })).toEqual(live);
          },
        ),
        { numRuns: 30 },
      );
      // La propiedad comparó respuestas repobladas desde el registro, no solo las de la caché viva.
      expect(comparedBeforeRestart).toBeGreaterThan(30);
    },
  );
});

/**
 * Verificación negativa: el último evento con autor queda con otro `clientMsgId` en la base (se
 * desactiva un momento el disparador que solo admite agregar filas).
 */
async function tamperLastAuthoredEvent(matchId: string): Promise<void> {
  const { client } = await testBank();
  await client.query("ALTER TABLE match_events DISABLE TRIGGER match_events_append_only");
  await client.query(
    `UPDATE match_events SET payload = jsonb_set(payload, '{clientMsgId}', to_jsonb((payload->>'clientMsgId') || '-tampered'))
     WHERE match_id = $1 AND seq = (SELECT max(seq) FROM match_events WHERE match_id = $1 AND payload ? 'clientMsgId')`,
    [matchId],
  );
  await client.query("ALTER TABLE match_events ENABLE TRIGGER match_events_append_only");
}
