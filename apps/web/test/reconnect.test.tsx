// Reconexión del cliente (F10, ADR 0002 y 0005, E-07): con la conexión caída, los números y la pista
// se bloquean y las notas se encolan; al volver, el cliente presenta su ficha, reemplaza lo
// confirmado con el snapshot y reenvía lo pendiente con el mismo `id`. La respuesta guardada a un
// comando que el servidor ya había aplicado (con `seq` dentro del snapshot) no se aplica dos veces.
import type { ClientEnvelope, LockedCell, PublicPlayer, Snapshot } from "@sudoku-killer/protocol";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameClient, PING_INTERVAL_MS, PONG_TIMEOUT_MS } from "../src/game/client.ts";
import { memoryPrefs } from "../src/game/prefs.ts";
import { memorySession, type SessionStore } from "../src/game/session.ts";
import { ME, TOMAS, fakeTransport, testPuzzle, type FakeTransport } from "./helpers/ui.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const CODE = "HPQ6NZ";
const TOKEN = "token-of-ines-0123456789";

function snapshot({
  atSeq,
  players = [ME, TOMAS],
  locked = [],
  groupNotes = [],
  personalNotes = [],
}: {
  atSeq: number;
  players?: PublicPlayer[];
  locked?: LockedCell[];
  groupNotes?: { cell: number; mask: number }[];
  personalNotes?: { cell: number; mask: number }[];
}): Snapshot {
  return {
    serverNow: 1_000_000,
    atSeq,
    room: { code: CODE, state: "running", starterId: ME.id, difficulty: "easy", players },
    match: {
      id: "m1",
      puzzle: testPuzzle(),
      startedAt: 1_000_000,
      endedAt: null,
      result: null,
      hintsLeft: 3,
      locked: [{ cell: 0, value: 5, source: "given", by: null }, ...locked],
      groupNotes,
      ranking: null,
    },
    you: { playerId: ME.id, settings: { autoCleanPersonalNotes: true }, personalNotes },
  };
}

/** Entra a una partida en curso con `room.join` y recibe la ficha. */
function joined(session: SessionStore = memorySession()): {
  client: GameClient;
  transport: FakeTransport;
  session: SessionStore;
} {
  const transport = fakeTransport();
  const client = new GameClient({ transport, prefs: memoryPrefs(), session });
  client.join(CODE, "Inés");
  const join = transport.last("room.join");
  transport.emit({
    type: "room.welcome",
    ...(join ? { replyTo: join.id } : {}),
    payload: { playerId: ME.id, token: TOKEN, snapshot: snapshot({ atSeq: 3 }) },
  });
  return { client, transport, session };
}

function sentOf(transport: FakeTransport, from: number): ClientEnvelope[] {
  return transport.sent.slice(from).filter((m) => m.type !== "sys.ping");
}

/** La conexión cae y vuelve; el cliente presenta su ficha. Devuelve ese `room.join`. */
function dropAndReturn(transport: FakeTransport) {
  transport.setStatus("reconnecting");
  transport.setStatus("open");
  const rejoin = transport.last("room.join");
  if (!rejoin) throw new Error("No room.join");
  return rejoin;
}

describe("reconnection (E-07, R-13)", () => {
  it("stores the token only in the session and presents it when the connection comes back", () => {
    const { client, transport, session } = joined();
    expect(session.token(CODE)).toBe(TOKEN);
    expect(session.lastRoom()).toBe(CODE);
    expect(JSON.stringify(client.getState())).not.toContain(TOKEN);
    const rejoin = dropAndReturn(transport);
    expect(rejoin.payload).toEqual({ code: CODE, nickname: "Inés", token: TOKEN });
  });

  it("blocks numbers and hints while away, queues notes and resends them with the same id", () => {
    const { client, transport } = joined();
    transport.setStatus("reconnecting");
    expect(client.getState().connection).toBe("reconnecting");
    expect(client.canPlace()).toBe(false);
    const before = transport.sent.length;
    client.select(10);
    client.input(4);
    client.useHint();
    // Sin poder colocar números, la tecla escribe una nota (como un espectador).
    expect(client.getState().pending.size).toBe(0);
    expect(client.getState().pendingNotes).toHaveLength(1);
    expect(sentOf(transport, before)).toEqual([]);
    const queued = client.getState().pendingNotes[0];

    transport.setStatus("open");
    const rejoin = transport.last("room.join");
    transport.emit({
      type: "room.welcome",
      ...(rejoin ? { replyTo: rejoin.id } : {}),
      payload: { playerId: ME.id, snapshot: snapshot({ atSeq: 7 }) },
    });
    const resent = sentOf(transport, before).filter((m) => m.type === "note.add");
    expect(resent).toHaveLength(1);
    expect(resent[0]?.id).toBe(queued?.id);
    expect(client.getState().connection).toBe("open");
    expect(client.getState().toasts.at(-1)?.text).toBe(
      "Conexión recuperada. Se envió 1 nota en cola.",
    );
    // La vista sigue mostrando la nota pendiente sobre lo confirmado.
    expect(client.getState().pendingNotes).toHaveLength(1);
  });

  it("does not apply twice a move the server had already applied (seq inside the snapshot)", () => {
    const { client, transport } = joined();
    client.select(10);
    client.input(7);
    const place = transport.last("cell.place");
    if (!place) throw new Error("No cell.place");
    expect(client.getState().pending.has(10)).toBe(true);
    const activity = client.getState().activity.length;

    // La conexión cae antes del veredicto; el servidor ya lo había aplicado (seq 8).
    const rejoin = dropAndReturn(transport);
    transport.emit({
      type: "room.welcome",
      ...(rejoin.id ? { replyTo: rejoin.id } : {}),
      payload: {
        playerId: ME.id,
        snapshot: snapshot({
          atSeq: 8,
          players: [{ ...ME, lives: 2, score: -90, mistakes: 1 }, TOMAS],
        }),
      },
    });
    // El cliente reenvía la jugada con el mismo id…
    expect(transport.sent.filter((m) => m.id === place.id)).toHaveLength(2);
    // …y recibe la respuesta guardada: solo se resuelve la celda pendiente.
    transport.emit({
      type: "cell.mistake",
      seq: 8,
      replyTo: place.id,
      payload: {
        cell: 10,
        digit: 7,
        by: ME.id,
        points: -90,
        score: -90,
        livesLeft: 2,
        role: "active",
      },
    });
    const state = client.getState();
    expect(state.pending.has(10)).toBe(false);
    expect(state.players.find((p) => p.id === ME.id)?.mistakes).toBe(1);
    expect(state.flashes.size).toBe(0);
    expect(state.activity.length).toBe(activity + 1); // solo el aviso «Conexión recuperada»
    // Un evento nuevo (seq 9) sí se aplica.
    transport.emit({
      type: "cell.solved",
      seq: 9,
      payload: { cell: 11, value: 3, by: TOMAS.id, points: 10, score: 10, bonuses: [] },
    });
    expect(client.getState().locked[11]?.value).toBe(3);
  });

  it("a new match after the snapshot starts again from seq 1", () => {
    const { client, transport } = joined();
    transport.emit({
      type: "match.ended",
      seq: 4,
      payload: { result: "victory", endedAt: 2, ranking: [] },
    });
    transport.emit({
      type: "match.started",
      seq: 1,
      payload: {
        matchId: "m2",
        puzzle: testPuzzle(),
        startedAt: 3,
        hintsLeft: 3,
        players: [ME, TOMAS],
      },
    });
    transport.emit({
      type: "cell.solved",
      seq: 2,
      payload: { cell: 12, value: 4, by: TOMAS.id, points: 10, score: 10, bonuses: [] },
    });
    expect(client.getState().match?.id).toBe("m2");
    expect(client.getState().locked[12]?.value).toBe(4);
  });

  it("back to a deleted room: home with the notice, and the token is forgotten", () => {
    const { client, transport, session } = joined();
    const rejoin = dropAndReturn(transport);
    transport.emit({ type: "error", replyTo: rejoin.id, payload: { code: "room.not_found" } });
    expect(client.getState().phase).toBe("home");
    expect(client.getState().roomNotice).toEqual({ kind: "gone", code: CODE });
    expect(session.token(CODE)).toBeNull();
    expect(client.savedRoom()).toBeNull();
  });

  it("back to a full room: home with the notice, and the token is kept (T-26.4)", () => {
    const { client, transport, session } = joined();
    const rejoin = dropAndReturn(transport);
    transport.emit({ type: "error", replyTo: rejoin.id, payload: { code: "room.full" } });
    expect(client.getState().roomNotice).toEqual({ kind: "full", code: CODE });
    expect(session.token(CODE)).toBe(TOKEN);
    expect(client.savedRoom()).toBe(CODE);
  });

  it("leaving on purpose keeps the token, so returning restores lives, points and notes (D3)", () => {
    const { client, transport, session } = joined();
    client.leave();
    expect(transport.last("room.leave")).toBeDefined();
    expect(session.token(CODE)).toBe(TOKEN);
    client.resume(CODE);
    expect(transport.last("room.join")?.payload).toEqual({
      code: CODE,
      nickname: "Inés",
      token: TOKEN,
    });
  });

  it(`reconnects when nothing arrives for ${String(PONG_TIMEOUT_MS)} ms (pong watchdog)`, () => {
    vi.useFakeTimers();
    const { client, transport } = joined();
    const reconnect = vi.spyOn(transport, "reconnect");
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    transport.emit({ type: "sys.pong", payload: { t0: 0, serverNow: 0 } });
    vi.advanceTimersByTime(PING_INTERVAL_MS * 2);
    expect(reconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(reconnect).toHaveBeenCalledTimes(1);
    client.destroy();
  });
});
