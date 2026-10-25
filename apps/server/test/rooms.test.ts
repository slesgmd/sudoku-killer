// Salas: acceso, capacidad, derecho de iniciar, salir y volver, plazos y borrado (SPEC §3, R-08 a
// R-14, R-22 a R-27 y R-30; E-08 y E-19). Servidor real con transporte en memoria, reloj falso,
// PGlite y el inspector de filtración activo (T-31.1).
import { defeatCause, replay } from "@sudoku-killer/game";
import { CLOSE_NO_ROOM, CLOSE_REPLACED, CLOSE_UNSUPPORTED } from "@sudoku-killer/protocol";
import { beforeAll, describe, expect, it } from "vitest";
import { hashToken } from "../src/infra/tokens.ts";
import {
  answer,
  exhaust,
  firstEmpty,
  playerIn,
  solveAllBut,
  started,
  table,
} from "./helpers/play.ts";
import { createTestServer, errorOf, mode, testBank, welcomeOf } from "./helpers/server.ts";

const GRACE = 120_000;

beforeAll(async () => {
  await testBank();
}, 60_000);

describe("R-09 access", () => {
  it("T-09.1 an unknown code gets room.not_found", async () => {
    const h = await createTestServer();
    expect(errorOf(await h.client().join("ZZZZZZ", "Ana"))).toBe("room.not_found");
  });

  it("T-09.2 'Ana' in a room where 'ana' is gets nickname.taken", async () => {
    const h = await createTestServer();
    const { code } = await table(h, ["ana"]);
    expect(errorOf(await h.client().join(code, "Ana"))).toBe("nickname.taken");
    expect(errorOf(await h.client().join(code, " ANA "))).toBe("nickname.taken");
  });

  it("T-09.3 (I) a nickname of 1 or 17 characters gets nickname.invalid, on create and on join", async () => {
    const h = await createTestServer();
    expect(errorOf(await h.client().create("A"))).toBe("nickname.invalid");
    const { code } = await table(h, ["Ana"]);
    expect(errorOf(await h.client().join(code, "B".repeat(17)))).toBe("nickname.invalid");
    expect(errorOf(await h.client().join(code, "   "))).toBe("nickname.invalid");
  });

  it("the code is case-insensitive", async () => {
    const h = await createTestServer();
    const { code } = await table(h, ["Ana"]);
    welcomeOf(await h.client().join(code.toLowerCase(), "Bea"));
  });
});

describe("R-08 capacity", () => {
  const SIX = ["Ana", "Bea", "Cris", "Dani", "Eli", "Fede"];

  it("T-08.1 with 6 seats taken, a seventh room.join gets room.full", async () => {
    const h = await createTestServer();
    const { code } = await table(h, SIX);
    expect(errorOf(await h.client().join(code, "Gabi"))).toBe("room.full");
  });

  it("T-08.2 a spectator keeps the seat, so the seventh is still rejected", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, SIX);
    const [, bea] = clients;
    if (!bea) throw new Error();
    await exhaust(h, code, bea);
    expect(playerIn(h, code, bea.playerId).role).toBe("spectator");
    expect(errorOf(await h.client().join(code, "Gabi"))).toBe("room.full");
  });

  it("T-08.3 a disconnected player holds the seat; one who left does not", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, SIX);
    const [, bea, cris] = clients;
    if (!bea || !cris) throw new Error();
    await bea.drop();
    expect(errorOf(await h.client().join(code, "Gabi"))).toBe("room.full");
    await cris.send("room.leave", {});
    const gabi = welcomeOf(await h.client().join(code, "Gabi"));
    expect(gabi.payload.snapshot.room.players.find((p) => p.nickname === "Gabi")?.seat).toBe(2);
  });
});

describe("R-10 and R-30 starting", () => {
  it("T-10.1 match.start from a player who is not the starter gets forbidden", async () => {
    const h = await createTestServer();
    const { clients } = await table(h, ["Ana", "Bea"]);
    expect(errorOf((await clients[1]?.send("match.start", {})) ?? [])).toBe("forbidden");
  });

  it("T-30.1 in a room with only its creator, match.start works", async () => {
    const h = await createTestServer();
    const { clients } = await table(h, ["Ana"]);
    const replies = (await clients[0]?.send("match.start", {})) ?? [];
    expect(replies.map((m) => m.type)).toEqual(["room.state_changed", "match.started"]);
  });
});

describe("R-11 starter succession", () => {
  it("T-11.1 if the starter leaves the lobby, the oldest player gets it and everybody is told", async () => {
    const h = await createTestServer();
    const { clients } = await table(h, ["Ana", "Bea", "Cris"]);
    const [ana, bea, cris] = clients;
    if (!ana || !bea || !cris) throw new Error();
    const mark = cris.mark();
    await ana.send("room.leave", {});
    for (const client of [bea, cris]) {
      expect(client.all("room.starter_changed", mark).map((m) => m.payload.playerId)).toEqual([
        bea.playerId,
      ]);
    }
    expect(
      (await bea.send("room.set_difficulty", { difficulty: "hard" })).map((m) => m.type),
    ).toEqual(["room.difficulty_set"]);
  });

  it("T-11.2 if the starter expires during a match, the right passes then and the new starter starts the next match", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error();
    await ana.drop();
    await h.advance(GRACE);
    expect(h.room(code).starterId).toBe(bea.playerId);
    const events = await h.repository.events(h.room(code).match?.state.id ?? "");
    expect(events.at(-1)).toMatchObject({
      type: "starter.changed",
      payload: { playerId: bea.playerId },
    });
    await solveAllBut(h, code, bea);
    expect(h.room(code).state).toBe("finished");
    await bea.send("room.reset", {});
    expect((await bea.send("match.start", {})).map((m) => m.type)).toContain("match.started");
  });

  it("T-11.3 a disconnected starter (within 120 s) keeps the right", async () => {
    const h = await createTestServer();
    const { code, clients } = await table(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error();
    const mark = bea.mark();
    await ana.drop();
    await h.advance(GRACE - 1);
    expect(h.room(code).starterId).toBe(ana.playerId);
    expect(bea.all("room.starter_changed", mark)).toEqual([]);
    expect(errorOf(await bea.send("match.start", {}))).toBe("forbidden");
  });

  it("T-11.4 a former starter who comes back with the token does not get the right back", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana?.token || !bea) throw new Error();
    await ana.send("room.leave", {});
    expect(h.room(code).starterId).toBe(bea.playerId);
    welcomeOf(await h.client().join(code, "Ana", ana.token));
    expect(h.room(code).starterId).toBe(bea.playerId);
  });

  it("T-11.5 if the starter leaves and nobody is left, the next to enter is the starter", async () => {
    const h = await createTestServer();
    const { code, clients } = await table(h, ["Ana"]);
    await clients[0]?.send("room.leave", {});
    expect(h.room(code).starterId).toBeNull();
    const bea = welcomeOf(await h.client().join(code, "Bea"));
    expect(bea.payload.snapshot.room.starterId).toBe(bea.payload.playerId);
  });
});

describe("R-12 joining a running match", () => {
  it("T-12.1 a new player with a free seat is active, with 3 lives and 0 points", async () => {
    const h = await createTestServer();
    const { code } = await started(h, ["Ana"]);
    const cris = h.client();
    const welcome = welcomeOf(await cris.join(code, "Cris"));
    const me = welcome.payload.snapshot.room.players.find((p) => p.id === welcome.payload.playerId);
    expect(me).toMatchObject({ role: "active", lives: 3, score: 0 });
    expect(welcome.payload.snapshot.match?.puzzle.id).toBe(h.room(code).match?.puzzle.id);
  });

  it("T-12.2 without a free seat it gets room.full", async () => {
    const h = await createTestServer();
    const { code } = await started(h, ["Ana", "Bea", "Cris", "Dani", "Eli", "Fede"]);
    expect(errorOf(await h.client().join(code, "Gabi"))).toBe("room.full");
  });
});

describe("R-13 disconnection and the 2-minute grace", () => {
  it("T-13.1 back at 119 s: same seat, lives, points and personal notes; everybody sees connected", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana?.token || !bea) throw new Error();
    const cell = firstEmpty(h, code);
    await ana.send("cell.place", { cell, digit: answer(h, code, cell) });
    const other = firstEmpty(h, code);
    await ana.send("note.add", { layer: "personal", cell: other, digit: 4 });
    const before = playerIn(h, code, ana.playerId);
    await ana.drop();
    await h.advance(GRACE - 1_000);
    const mark = bea.mark();
    const back = h.client();
    const welcome = welcomeOf(await back.join(code, "ignored", ana.token));
    expect(welcome.payload.token).toBeUndefined();
    const me = welcome.payload.snapshot.room.players.find((p) => p.id === ana.playerId);
    expect(me).toMatchObject({
      seat: before.seat,
      lives: before.lives,
      score: before.score,
      connection: "connected",
    });
    expect(welcome.payload.snapshot.you.personalNotes).toEqual([{ cell: other, mask: 1 << 3 }]);
    expect(bea.all("room.player_connection", mark).map((m) => m.payload)).toEqual([
      { playerId: ana.playerId, connection: "connected", seat: before.seat },
    ]);
  });

  it("T-13.2 at 120 s it expires and the seat is free; later, with a seat, it recovers its data (D3')", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana?.token || !bea) throw new Error();
    const cell = firstEmpty(h, code);
    await ana.send("cell.place", {
      cell,
      digit: answer(h, code, cell) + (answer(h, code, cell) === 9 ? -1 : 1),
    });
    const before = playerIn(h, code, ana.playerId);
    await ana.drop();
    await h.advance(GRACE);
    expect(playerIn(h, code, ana.playerId)).toMatchObject({ connection: "expired", seat: null });
    expect(bea.last("room.player_connection")?.payload).toEqual({
      playerId: ana.playerId,
      connection: "expired",
      seat: null,
    });
    await h.advance(60_000);
    const welcome = welcomeOf(await h.client().join(code, "Ana", ana.token));
    const me = welcome.payload.snapshot.room.players.find((p) => p.id === ana.playerId);
    expect(me).toMatchObject({
      lives: 2,
      score: before.score,
      mistakes: 1,
      connection: "connected",
    });
    expect(me?.lives).toBe(before.lives);
  });

  it("T-13.3 an invalid token is a new entry with the message nickname", async () => {
    const h = await createTestServer();
    const { code } = await table(h, ["Ana"]);
    const welcome = welcomeOf(await h.client().join(code, "Bea", "not-a-real-token"));
    expect(welcome.payload.token).toBeDefined();
    expect(welcome.payload.snapshot.room.players.map((p) => p.nickname)).toEqual(["Ana", "Bea"]);
  });

  it("T-13.4 the token has 128 bits; the log and the events keep only its SHA-256", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const late = h.client();
    welcomeOf(await late.join(code, "Cris"));
    const tokens = [...clients, late].map((c) => c.token ?? "");
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(Buffer.from(token, "base64url")).toHaveLength(16);
    }
    expect(new Set(tokens).size).toBe(tokens.length);
    const log = JSON.stringify(await h.repository.events(h.room(code).match?.state.id ?? ""));
    for (const token of tokens) {
      expect(log).not.toContain(token);
      expect(log).toContain(hashToken(token));
    }
  });
});

describe("R-14 deleting the room", () => {
  it("T-14.1 120 s after the last connected player drops, the room is deleted", async () => {
    const h = await createTestServer();
    const { code, clients } = await table(h, ["Ana", "Bea"]);
    for (const client of clients) await client.drop();
    await h.advance(GRACE);
    expect(h.server.rooms.has(code)).toBe(false);
    expect(errorOf(await h.client().join(code, "Cris"))).toBe("room.not_found");
  });

  it("T-14.2 if someone comes back at 119 s, the room is not deleted", async () => {
    const h = await createTestServer();
    const { code, clients } = await table(h, ["Ana"]);
    const [ana] = clients;
    if (!ana?.token) throw new Error();
    await ana.drop();
    await h.advance(GRACE - 1_000);
    welcomeOf(await h.client().join(code, "Ana", ana.token));
    await h.advance(GRACE);
    expect(h.server.rooms.has(code)).toBe(true);
  });

  it("T-14.3 with a running match, match.ended{defeat} is in the log before the deletion", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const match = h.room(code).match;
    if (!match) throw new Error();
    const matchId = match.state.id;
    for (const client of clients) await client.drop();
    await h.advance(GRACE);
    expect(h.server.rooms.has(code)).toBe(false);
    const events = await h.repository.events(matchId);
    expect(events.at(-1)).toMatchObject({ type: "match.ended", payload: { result: "defeat" } });
    expect(
      events.filter((e) => e.type === "player.connection").map((e) => e.payload.connection),
    ).toEqual(["disconnected", "disconnected", "expired", "expired"]);
    // SPEC 1.8: todos expiraron con sus vidas. El evento del registro no cambia de forma.
    expect(Object.keys(events.at(-1)?.payload ?? {})).toEqual(["result"]);
    expect(defeatCause(replay(events, { mode, puzzle: match.puzzle }))).toBe("gone");
  });
});

describe("R-22 and R-27 the end of a match", () => {
  it("T-22.3 and T-27.2 the end purges who left or expired: the nickname is free and the token stops working", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea", "Cris"]);
    const [ana, bea, cris] = clients;
    if (!ana || !bea?.token || !cris?.token) throw new Error();
    await bea.send("room.leave", {});
    await cris.drop();
    await h.advance(GRACE);
    // T-27.1: mientras dura la partida, sus apodos siguen reservados.
    expect(errorOf(await h.client().join(code, "Bea"))).toBe("nickname.taken");
    expect(errorOf(await h.client().join(code, "cris"))).toBe("nickname.taken");
    const mark = ana.mark();
    await solveAllBut(h, code, ana);
    expect(
      ana
        .all("room.player_removed", mark)
        .map((m) => m.payload.playerId)
        .sort(),
    ).toEqual([bea.playerId, cris.playerId].sort());
    const again = welcomeOf(await h.client().join(code, "Dani", bea.token));
    expect(again.payload.playerId).not.toBe(bea.playerId);
    welcomeOf(await h.client().join(code, "Bea"));
  });
});

describe("R-23 and R-26 leaving and coming back", () => {
  it("T-26.1 and T-02.4 room.leave during a match frees the seat at once, and the player stays in the ranking", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error();
    const replies = await bea.send("room.leave", {});
    expect(replies.map((m) => m.type)).toEqual(["ack"]);
    expect(playerIn(h, code, bea.playerId)).toMatchObject({ connection: "left", seat: null });
    await solveAllBut(h, code, ana);
    const ended = ana.last("match.ended");
    expect(ended?.payload.ranking.map((r) => r.playerId)).toContain(bea.playerId);
  });

  it("T-26.2 back with the token to the same match with a free seat: lives, points and personal notes", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [, bea] = clients;
    if (!bea?.token) throw new Error();
    const cell = firstEmpty(h, code);
    await bea.send("cell.place", { cell, digit: answer(h, code, cell) });
    await bea.send("note.add", { layer: "personal", cell: firstEmpty(h, code), digit: 2 });
    const before = playerIn(h, code, bea.playerId);
    await bea.send("room.leave", {});
    const welcome = welcomeOf(await h.client().join(code, "x", bea.token));
    const me = welcome.payload.snapshot.room.players.find((p) => p.id === bea.playerId);
    expect(me).toMatchObject({ lives: before.lives, score: before.score, seat: 1, role: "active" });
    expect(welcome.payload.snapshot.you.personalNotes).toHaveLength(1);
  });

  it("T-26.3 and T-23.3 with 0 lives it comes back as a spectator", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [, bea] = clients;
    if (!bea?.token) throw new Error();
    await exhaust(h, code, bea);
    await bea.send("room.leave", {});
    const welcome = welcomeOf(await h.client().join(code, "Bea", bea.token));
    const me = welcome.payload.snapshot.room.players.find((p) => p.id === bea.playerId);
    expect(me).toMatchObject({ role: "spectator", lives: 0 });
  });

  it("T-26.4 back with the token and no free seat: room.full, and the data is kept", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea", "Cris", "Dani", "Eli", "Fede"]);
    const [, bea] = clients;
    if (!bea?.token) throw new Error();
    const cell = firstEmpty(h, code);
    await bea.send("cell.place", { cell, digit: answer(h, code, cell) });
    const before = playerIn(h, code, bea.playerId);
    await bea.send("room.leave", {});
    const gabi = h.client();
    welcomeOf(await gabi.join(code, "Gabi"));
    expect(errorOf(await h.client().join(code, "Bea", bea.token))).toBe("room.full");
    await gabi.send("room.leave", {});
    const welcome = welcomeOf(await h.client().join(code, "Bea", bea.token));
    const me = welcome.payload.snapshot.room.players.find((p) => p.id === bea.playerId);
    expect(me).toMatchObject({ score: before.score, lives: before.lives });
  });

  it("T-26.5 without the token and with another nickname it enters as a new player with 3 lives (accepted limitation of D3)", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [, bea] = clients;
    if (!bea) throw new Error();
    await exhaust(h, code, bea);
    await bea.send("room.leave", {});
    const welcome = welcomeOf(await h.client().join(code, "Bea2"));
    const me = welcome.payload.snapshot.room.players.find((p) => p.id === welcome.payload.playerId);
    expect(me).toMatchObject({ role: "active", lives: 3, score: 0 });
  });

  it("T-26.6 room.leave in the lobby removes the player and frees the nickname", async () => {
    const h = await createTestServer();
    const { code, clients } = await table(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error();
    const mark = ana.mark();
    await bea.send("room.leave", {});
    expect(ana.all("room.player_removed", mark).map((m) => m.payload.playerId)).toEqual([
      bea.playerId,
    ]);
    welcomeOf(await h.client().join(code, "bea"));
  });
});

describe("connections", () => {
  it("E-08 the same token in a second tab replaces the first, which is closed with 4001", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana?.token || !bea) throw new Error();
    const mark = bea.mark();
    const tab = h.client();
    const welcome = welcomeOf(await tab.join(code, "Ana", ana.token));
    expect(welcome.payload.playerId).toBe(ana.playerId);
    expect(ana.link.closed?.code).toBe(CLOSE_REPLACED);
    expect(bea.all("room.player_connection", mark)).toEqual([]);
    expect(playerIn(h, code, ana.playerId).connection).toBe("connected");
    // La pestaña nueva juega; la vieja ya no recibe nada.
    const cell = firstEmpty(h, code);
    const replies = await tab.send("cell.place", { cell, digit: answer(h, code, cell) });
    expect(replies.map((m) => m.type)).toEqual(["cell.solved"]);
  });

  it("E-19 another protocol version gets protocol.unsupported and the connection closes with 4000", async () => {
    const h = await createTestServer();
    const client = h.client();
    client.link.send(
      JSON.stringify({ v: 2, id: "x", type: "room.create", payload: { nickname: "Ana" } }),
    );
    await h.settle();
    expect(client.messages).toEqual([
      { v: 1, type: "error", payload: { code: "protocol.unsupported" }, replyTo: "x" },
    ]);
    expect(client.link.closed?.code).toBe(CLOSE_UNSUPPORTED);
  });

  it("a connection that does not enter a room in 30 s is closed with 4002 (ADR 0002)", async () => {
    const h = await createTestServer();
    const idle = h.client();
    const { clients } = await table(h, ["Ana"]);
    await h.advance(30_000);
    expect(idle.link.closed?.code).toBe(CLOSE_NO_ROOM);
    expect(clients[0]?.link.closed).toBeNull();
    // Al salir de la sala vuelve a correr el plazo.
    await clients[0]?.send("room.leave", {});
    await h.advance(30_000);
    expect(clients[0]?.link.closed?.code).toBe(CLOSE_NO_ROOM);
  });

  it("E-18 invalid JSON, an unknown type and extra fields get bad_request without changing anything", async () => {
    const h = await createTestServer();
    const { code, clients } = await table(h, ["Ana"]);
    const [ana] = clients;
    if (!ana) throw new Error();
    ana.link.send("{nope");
    ana.link.send(JSON.stringify({ v: 1, id: "k", type: "room.kick", payload: {} }));
    ana.link.send(JSON.stringify({ v: 1, id: "e", type: "room.leave", payload: { now: true } }));
    await h.settle();
    expect(ana.messages.slice(-3).map((m) => m.type === "error" && m.payload.code)).toEqual([
      "bad_request",
      "bad_request",
      "bad_request",
    ]);
    expect(h.room(code).members.size).toBe(1);
  });
});
