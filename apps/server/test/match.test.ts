// Partida en vivo contra el servidor real (SPEC §6): resultado, vidas, jugadas simultáneas, notas,
// limpieza, pistas, dificultad, partidas siguientes, espectadores, presencia, deshacer y límites.
// Transporte en memoria, reloj falso, PGlite y el inspector de filtración activo (T-31.1, T-29.1).
import { digitBit, layoutOf, peersWithCage } from "@sudoku-killer/engine";
import { PARAMS_V1 } from "@sudoku-killer/scoring";
import { beforeAll, describe, expect, it } from "vitest";
import {
  answer,
  emptyCells,
  exhaust,
  firstEmpty,
  playerIn,
  solveAllBut,
  started,
  table,
  wrong,
} from "./helpers/play.ts";
import { createTestServer, errorOf, testBank, welcomeOf } from "./helpers/server.ts";

const { mistakePenalty: P, hintPenalty: H } = PARAMS_V1;
const GRACE = 120_000;

beforeAll(async () => {
  await testBank();
}, 60_000);

/** Un par de la celda que sigue vacía. */
function emptyPeer(
  h: Awaited<ReturnType<typeof createTestServer>>,
  code: string,
  cell: number,
): number {
  const match = h.room(code).match;
  if (!match) throw new Error("No match");
  const cage = match.puzzle.cages.find((c) => c.cells.includes(cell));
  const peers = peersWithCage(layoutOf(match.puzzle), cage, cell);
  const peer = [...peers].find((p) => match.state.cells[p]?.status === "empty");
  if (peer === undefined) throw new Error("No empty peer");
  return peer;
}

describe("R-01 team result", () => {
  it("T-01.1 and E-12 the last correct cell: everybody gets cell.solved and then match.ended{victory}; later commands get match.not_running", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error();
    const last = firstEmpty(h, code);
    await solveAllBut(h, code, ana, [last]);
    const mark = bea.mark();
    await ana.send("cell.place", { cell: last, digit: answer(h, code, last) });
    expect(bea.since(mark).map((m) => m.type)).toEqual([
      "cell.solved",
      "match.ended",
      "room.state_changed",
    ]);
    expect(bea.last("match.ended")?.payload.result).toBe("victory");
    expect(h.room(code).state).toBe("finished");
    expect(errorOf(await ana.send("cell.place", { cell: last, digit: 1 }))).toBe(
      "match.not_running",
    );
  });

  it("T-01.2 the only active player with 1 life makes a mistake: spectator and defeat", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error();
    await exhaust(h, code, bea);
    const cell = firstEmpty(h, code);
    await ana.send("cell.place", { cell, digit: wrong(h, code, cell, 0) });
    await ana.send("cell.place", { cell, digit: wrong(h, code, cell, 1) });
    const replies = await ana.send("cell.place", { cell, digit: wrong(h, code, cell, 2) });
    expect(replies.map((m) => m.type)).toEqual(["cell.mistake", "match.ended"]);
    expect(ana.last("room.state_changed")?.payload.state).toBe("finished");
    expect(ana.last("cell.mistake")?.payload.role).toBe("spectator");
    expect(ana.last("match.ended")?.payload.result).toBe("defeat");
  });

  it("T-01.3 the only active player disconnects; at 120 s it expires and the match ends in defeat", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error();
    await exhaust(h, code, bea);
    await ana.drop();
    await h.advance(GRACE - 1);
    expect(h.room(code).state).toBe("running");
    await h.advance(1);
    expect(bea.last("match.ended")?.payload.result).toBe("defeat");
  });

  it("T-01.4 the only active player disconnected for 60 s with spectators connected: still running", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error();
    await exhaust(h, code, bea);
    await ana.drop();
    await h.advance(60_000);
    expect(h.room(code).state).toBe("running");
    expect(bea.all("match.ended")).toEqual([]);
  });

  it("T-01.5 a hint on the last empty cell is a victory", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana"]);
    const [ana] = clients;
    if (!ana) throw new Error();
    const last = firstEmpty(h, code);
    await solveAllBut(h, code, ana, [last]);
    const replies = await ana.send("hint.use", { cell: last });
    expect(replies.map((m) => m.type)).toEqual(["hint.used", "match.ended"]);
    expect(ana.last("match.ended")?.payload.result).toBe("victory");
  });
});

describe("R-03 lives and R-04 visible moves", () => {
  it("T-03.1 a wrong digit: 3 → 2 lives, −P, and everybody gets cell.mistake with by, livesLeft and role", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error();
    const cell = firstEmpty(h, code);
    const digit = wrong(h, code, cell);
    await ana.send("cell.place", { cell, digit });
    for (const client of [ana, bea]) {
      expect(client.last("cell.mistake")?.payload).toEqual({
        cell,
        digit,
        by: ana.playerId,
        points: -P,
        score: -P,
        livesLeft: 2,
        role: "active",
      });
    }
  });

  it("T-03.2 the third mistake: spectator, with the score before minus P", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [, bea] = clients;
    if (!bea) throw new Error();
    await exhaust(h, code, bea);
    expect(playerIn(h, code, bea.playerId)).toMatchObject({
      role: "spectator",
      lives: 0,
      score: -3 * P,
    });
  });

  it("T-03.3 a second wrong digit on the same cell is a new mistake", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana"]);
    const [ana] = clients;
    if (!ana) throw new Error();
    const cell = firstEmpty(h, code);
    await ana.send("cell.place", { cell, digit: wrong(h, code, cell, 0) });
    await ana.send("cell.place", { cell, digit: wrong(h, code, cell, 1) });
    expect(playerIn(h, code, ana.playerId)).toMatchObject({ lives: 1, mistakes: 2 });
  });

  it("T-04.1 and T-04.2 after cell.solved the snapshot has the cell locked with by; after cell.mistake, no value", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana"]);
    const [ana] = clients;
    if (!ana) throw new Error();
    const [solved, missed] = emptyCells(h, code);
    if (solved === undefined || missed === undefined) throw new Error();
    await ana.send("cell.place", { cell: solved, digit: answer(h, code, solved) });
    await ana.send("cell.place", { cell: missed, digit: wrong(h, code, missed) });
    const late = welcomeOf(await h.client().join(code, "Bea"));
    const locked = late.payload.snapshot.match?.locked ?? [];
    expect(locked).toContainEqual({
      cell: solved,
      value: answer(h, code, solved),
      source: "solved",
      by: ana.playerId,
    });
    expect(locked.some((l) => l.cell === missed)).toBe(false);
  });
});

describe("R-05 locked cells and simultaneous moves", () => {
  it("T-05.1 two correct moves on the same cell in the same batch: solved, then already_solved, one event", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error();
    const cell = firstEmpty(h, code);
    const digit = answer(h, code, cell);
    const first = ana.post("cell.place", { cell, digit });
    const second = bea.post("cell.place", { cell, digit });
    await h.settle();
    expect(ana.replies(first).map((m) => m.type)).toEqual(["cell.solved"]);
    expect(bea.replies(second)).toEqual([
      { v: 1, type: "cell.already_solved", payload: { cell }, replyTo: second },
    ]);
    expect(playerIn(h, code, bea.playerId)).toMatchObject({ lives: 3, score: 0 });
    const events = await h.repository.events(h.room(code).match?.state.id ?? "");
    expect(events.filter((e) => e.type === "cell.solved")).toHaveLength(1);
  });

  it("T-05.2 a move on a given gets already_solved without penalty", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana"]);
    const given = h.room(code).match?.puzzle.givens[0];
    if (!given || !clients[0]) throw new Error();
    const replies = await clients[0].send("cell.place", {
      cell: given.cell,
      digit: (given.value % 9) + 1,
    });
    expect(replies.map((m) => m.type)).toEqual(["cell.already_solved"]);
    expect(playerIn(h, code, clients[0].playerId)).toMatchObject({ lives: 3, score: 0 });
  });

  it("T-05.3 a wrong digit on a locked cell gets already_solved, not a mistake", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana"]);
    const [ana] = clients;
    if (!ana) throw new Error();
    const cell = firstEmpty(h, code);
    await ana.send("cell.place", { cell, digit: answer(h, code, cell) });
    expect(
      (await ana.send("cell.place", { cell, digit: wrong(h, code, cell) })).map((m) => m.type),
    ).toEqual(["cell.already_solved"]);
  });

  it("T-05.5 a wrong move then a correct one in the same batch: mistake, then solved; two events", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error();
    const cell = firstEmpty(h, code);
    const first = ana.post("cell.place", { cell, digit: wrong(h, code, cell) });
    const second = bea.post("cell.place", { cell, digit: answer(h, code, cell) });
    await h.settle();
    expect(ana.replies(first).map((m) => m.type)).toEqual(["cell.mistake"]);
    expect(bea.replies(second).map((m) => m.type)).toEqual(["cell.solved"]);
    const events = await h.repository.events(h.room(code).match?.state.id ?? "");
    expect(events.slice(-2).map((e) => e.type)).toEqual(["cell.mistake", "cell.solved"]);
  });

  it("T-28.1 a digit repeating a locked peer is processed as a mistake", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana"]);
    const [ana] = clients;
    if (!ana) throw new Error();
    const cell = firstEmpty(h, code);
    await ana.send("cell.place", { cell, digit: answer(h, code, cell) });
    const peer = emptyPeer(h, code, cell);
    const replies = await ana.send("cell.place", { cell: peer, digit: answer(h, code, cell) });
    expect(replies.map((m) => m.type)).toEqual(["cell.mistake"]);
  });
});

describe("R-06, R-15, R-16 and R-29 notes", () => {
  it("T-06.2 and T-29.1 a personal note reaches only its owner; a group note reaches everybody", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error();
    const cell = firstEmpty(h, code);
    const mark = bea.mark();
    await ana.send("note.add", { layer: "personal", cell, digit: 3 });
    expect(ana.last("note.applied")?.payload).toMatchObject({
      layer: "personal",
      cell,
      digit: 3,
      op: "add",
    });
    expect(bea.since(mark)).toEqual([]);
    await ana.send("note.add", { layer: "group", cell, digit: 5 });
    expect(bea.last("note.applied")?.payload).toMatchObject({
      layer: "group",
      cell,
      digit: 5,
      by: ana.playerId,
    });
    // El snapshot de Bea no trae las notas personales de Ana.
    const tab = welcomeOf(await h.client().join(code, "Bea", bea.token ?? ""));
    expect(tab.payload.snapshot.you.personalNotes).toEqual([]);
    expect(tab.payload.snapshot.match?.groupNotes).toEqual([{ cell, mask: digitBit(5) }]);
  });

  it("T-15.2 a note on a locked cell gets cell.locked", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana"]);
    const given = h.room(code).match?.puzzle.givens[0];
    if (!given || !clients[0]) throw new Error();
    expect(
      errorOf(await clients[0].send("note.add", { layer: "group", cell: given.cell, digit: 1 })),
    ).toBe("cell.locked");
  });

  it("T-16.3 adding a candidate that is already there gets ack{applied:false} and no event", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana"]);
    const [ana] = clients;
    if (!ana) throw new Error();
    const cell = firstEmpty(h, code);
    await ana.send("note.add", { layer: "group", cell, digit: 2 });
    const before = h.room(code).match?.state.seq;
    const replies = await ana.send("note.add", { layer: "group", cell, digit: 2 });
    expect(replies.map((m) => m.payload)).toEqual([{ applied: false }]);
    expect(h.room(code).match?.state.seq).toBe(before);
  });
});

describe("R-17 automatic cleanup", () => {
  it("T-17.2 (I) with the setting off, only the locked cell loses its personal notes", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error();
    const cell = firstEmpty(h, code);
    const peer = emptyPeer(h, code, cell);
    const digit = answer(h, code, cell);
    await bea.send("settings.update", { autoCleanPersonalNotes: false });
    await ana.send("note.add", { layer: "personal", cell: peer, digit });
    await bea.send("note.add", { layer: "personal", cell: peer, digit });
    await bea.send("note.add", { layer: "personal", cell, digit });
    await ana.send("cell.place", { cell, digit });
    expect(playerIn(h, code, ana.playerId).personalNotes[peer]).toBe(0);
    expect(playerIn(h, code, bea.playerId).personalNotes[peer]).toBe(digitBit(digit));
    expect(playerIn(h, code, bea.playerId).personalNotes[cell]).toBe(0);
  });

  it("T-17.3 a mistake cleans nothing", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana"]);
    const [ana] = clients;
    if (!ana) throw new Error();
    const cell = firstEmpty(h, code);
    const peer = emptyPeer(h, code, cell);
    const digit = wrong(h, code, cell);
    await ana.send("note.add", { layer: "group", cell: peer, digit });
    await ana.send("note.add", { layer: "group", cell, digit });
    await ana.send("cell.place", { cell, digit });
    const notes = h.room(code).match?.state.groupNotes;
    expect([notes?.[peer], notes?.[cell]]).toEqual([digitBit(digit), digitBit(digit)]);
  });

  it("T-17.4 a hint cleans like a correct move", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana"]);
    const [ana] = clients;
    if (!ana) throw new Error();
    const cell = firstEmpty(h, code);
    const peer = emptyPeer(h, code, cell);
    const digit = answer(h, code, cell);
    await ana.send("note.add", { layer: "group", cell: peer, digit });
    await ana.send("hint.use", { cell });
    expect(h.room(code).match?.state.groupNotes[peer]).toBe(0);
  });

  it("T-17.5 a newly joined player has autoCleanPersonalNotes = true", async () => {
    const h = await createTestServer();
    const { code } = await started(h, ["Ana"]);
    const welcome = welcomeOf(await h.client().join(code, "Bea"));
    expect(welcome.payload.snapshot.you.settings).toEqual({ autoCleanPersonalNotes: true });
  });
});

describe("R-07 common timer", () => {
  it("T-07.1 (I) match.started and the snapshot carry startedAt and serverNow; match.pause gets bad_request", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana"]);
    const [ana] = clients;
    if (!ana) throw new Error();
    const startedAt = ana.last("match.started")?.payload.startedAt;
    expect(startedAt).toBe(h.room(code).match?.state.startedAt);
    await h.advance(5_000);
    const welcome = welcomeOf(await h.client().join(code, "Bea"));
    expect(welcome.payload.snapshot).toMatchObject({
      serverNow: h.clock.now(),
      match: { startedAt },
    });
    expect(errorOf(await ana.send("match.pause" as "match.start", {}))).toBe("bad_request");
  });
});

describe("R-19 hints", () => {
  it("T-19.1 a hint: everybody gets hint.used with value and by, the cell locks as hint, 3 → 2, −H and no bonus", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error();
    const cell = firstEmpty(h, code);
    await ana.send("hint.use", { cell });
    expect(bea.last("hint.used")?.payload).toEqual({
      cell,
      value: answer(h, code, cell),
      by: ana.playerId,
      points: -H,
      score: -H,
      hintsLeft: 2,
    });
    expect(h.room(code).match?.state.cells[cell]).toMatchObject({
      status: "locked",
      source: "hint",
    });
  });

  it("T-19.2 with no hints left, hint.use gets hint.none_left", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana"]);
    const [ana] = clients;
    if (!ana) throw new Error();
    for (let i = 0; i < 3; i++) await ana.send("hint.use", { cell: firstEmpty(h, code) });
    expect(errorOf(await ana.send("hint.use", { cell: firstEmpty(h, code) }))).toBe(
      "hint.none_left",
    );
  });

  it("T-19.3 and E-04 a hint on a locked cell gets already_solved and does not spend a hint", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error();
    const cell = firstEmpty(h, code);
    ana.post("cell.place", { cell, digit: answer(h, code, cell) });
    const hint = bea.post("hint.use", { cell });
    await h.settle();
    expect(bea.replies(hint).map((m) => m.type)).toEqual(["cell.already_solved"]);
    expect(h.room(code).match?.state.hintsLeft).toBe(3);
  });

  it("T-19.4 and T-23.2 a spectator gets forbidden for hint.use and cell.place, without changes", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [, bea] = clients;
    if (!bea) throw new Error();
    await exhaust(h, code, bea);
    const before = playerIn(h, code, bea.playerId);
    const cell = firstEmpty(h, code);
    expect(errorOf(await bea.send("hint.use", { cell }))).toBe("forbidden");
    expect(errorOf(await bea.send("cell.place", { cell, digit: answer(h, code, cell) }))).toBe(
      "forbidden",
    );
    expect(playerIn(h, code, bea.playerId)).toMatchObject({
      lives: before.lives,
      score: before.score,
    });
  });
});

describe("R-21 difficulty and puzzle choice", () => {
  it("T-21.1 set_difficulty reaches everybody, and match.start picks a puzzle of it not yet played", async () => {
    const h = await createTestServer();
    const { code, clients } = await table(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error();
    await ana.send("room.set_difficulty", { difficulty: "medium" });
    expect(bea.last("room.difficulty_set")?.payload).toEqual({ difficulty: "medium" });
    await ana.send("match.start", {});
    expect(h.room(code).match?.puzzle.difficulty).toBe("medium");
    // Dos partidas fáciles seguidas: puzzles distintos (el banco de pruebas tiene dos).
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      await solveAllBut(h, code, ana);
      await ana.send("room.reset", {});
      await ana.send("room.set_difficulty", { difficulty: "easy" });
      await ana.send("match.start", {});
      seen.push(h.room(code).match?.puzzle.id ?? "");
    }
    expect(new Set(seen.slice(0, 2)).size).toBe(2);
    // T-21.2 (I): con las dos jugadas, vuelve la que se jugó hace más tiempo.
    expect(seen[2]).toBe(seen[0]);
  });

  it("T-21.3 set_difficulty from a player who is not the starter gets forbidden", async () => {
    const h = await createTestServer();
    const { clients } = await table(h, ["Ana", "Bea"]);
    expect(
      errorOf((await clients[1]?.send("room.set_difficulty", { difficulty: "hard" })) ?? []),
    ).toBe("forbidden");
  });
});

describe("R-22 next matches", () => {
  it("T-22.1 and T-22.2 after the end, room.reset → waiting; the next match starts everybody active with 3 lives, 0 points, empty notes and 3 hints", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error();
    await bea.send("note.add", { layer: "personal", cell: firstEmpty(h, code), digit: 1 });
    await ana.send("hint.use", { cell: firstEmpty(h, code) });
    await solveAllBut(h, code, ana);
    expect(h.room(code).state).toBe("finished");
    expect(errorOf(await ana.send("match.start", {}))).toBe("room.wrong_state");
    await ana.send("room.reset", {});
    expect(bea.last("room.state_changed")?.payload.state).toBe("waiting");
    await ana.send("match.start", {});
    const players = bea.last("match.started")?.payload.players ?? [];
    expect(players.map((p) => [p.role, p.lives, p.score])).toEqual([
      ["active", 3, 0],
      ["active", 3, 0],
    ]);
    expect(h.room(code).match?.state.hintsLeft).toBe(3);
    expect([...playerIn(h, code, bea.playerId).personalNotes].every((mask) => mask === 0)).toBe(
      true,
    );
  });
});

describe("R-23 spectators", () => {
  it("T-23.1 a spectator's group note is applied and reaches everybody", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error();
    await exhaust(h, code, bea);
    const cell = firstEmpty(h, code);
    await bea.send("note.add", { layer: "group", cell, digit: 7 });
    expect(ana.last("note.applied")?.payload).toMatchObject({
      layer: "group",
      by: bea.playerId,
      cell,
      digit: 7,
    });
  });
});

describe("R-24 presence", () => {
  it("T-24.1 presence.select reaches the others as presence.updated and adds no event", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error();
    const seq = h.room(code).match?.state.seq;
    const mark = ana.mark();
    await bea.send("presence.select", { cell: 10 });
    expect(ana.since(mark)).toEqual([
      { v: 1, type: "presence.updated", payload: { playerId: bea.playerId, cell: 10 } },
    ]);
    expect(bea.all("presence.updated")).toEqual([]);
    expect(h.room(code).match?.state.seq).toBe(seq);
  });

  it("T-24.2 a burst of 50 selections in 1 s gives at most 10 broadcasts, and the last one is the final selection", async () => {
    const h = await createTestServer();
    const { clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error();
    const mark = ana.mark();
    for (let i = 0; i < 50; i++) {
      bea.post("presence.select", { cell: i });
      await h.advance(20);
    }
    await h.advance(200);
    const updates = ana.all("presence.updated", mark);
    expect(updates.length).toBeLessThanOrEqual(11);
    expect(updates.length).toBeGreaterThan(1);
    expect(updates.at(-1)?.payload.cell).toBe(49);
    // En el primer segundo, como máximo 10.
    expect(updates.slice(0, -1).length).toBeLessThanOrEqual(10);
  });
});

describe("R-25 undoing notes", () => {
  async function noted() {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error();
    const cell = firstEmpty(h, code);
    const digit = wrong(h, code, cell);
    const [applied] = await ana.send("note.add", { layer: "group", cell, digit });
    if (applied?.type !== "note.applied") throw new Error("No note.applied");
    return { h, code, ana, bea, cell, digit, opSeq: applied.payload.opSeq };
  }

  it("T-25.1 undoing an own group add without later changes: a remove with undoOf reaches everybody", async () => {
    const { ana, bea, cell, digit, opSeq } = await noted();
    await ana.send("note.undo", { opSeq });
    expect(bea.last("note.applied")?.payload).toMatchObject({
      op: "remove",
      cell,
      digit,
      undoOf: opSeq,
    });
  });

  it("T-25.2 if another player changed that candidate, note.undo gets undo.not_applicable{modified}", async () => {
    const { h, code, ana, bea, cell, digit, opSeq } = await noted();
    await bea.send("note.remove", { layer: "group", cell, digit });
    await bea.send("note.add", { layer: "group", cell, digit });
    const replies = await ana.send("note.undo", { opSeq });
    expect(replies.map((m) => m.payload)).toEqual([
      { code: "undo.not_applicable", reason: "modified" },
    ]);
    expect(h.room(code).match?.state.groupNotes[cell]).toBe(digitBit(digit));
  });

  it("T-25.3 after a cleanup or a lock, note.undo gets undo.not_applicable{modified}", async () => {
    const { h, code, ana, cell, opSeq } = await noted();
    await ana.send("cell.place", { cell, digit: answer(h, code, cell) });
    expect((await ana.send("note.undo", { opSeq })).map((m) => m.payload)).toEqual([
      { code: "undo.not_applicable", reason: "modified" },
    ]);
  });

  it("T-25.4 undoing another player's operation gets undo.not_applicable{not_owner}", async () => {
    const { bea, opSeq } = await noted();
    expect((await bea.send("note.undo", { opSeq })).map((m) => m.payload)).toEqual([
      { code: "undo.not_applicable", reason: "not_owner" },
    ]);
  });

  it("T-25.5 undoing a personal note follows the same rule, and only the owner gets the result", async () => {
    const { h, code, ana, bea } = await noted();
    const cell = emptyCells(h, code)[1] ?? 0;
    const [applied] = await ana.send("note.add", { layer: "personal", cell, digit: 4 });
    if (applied?.type !== "note.applied") throw new Error();
    const mark = bea.mark();
    expect(
      (await ana.send("note.undo", { opSeq: applied.payload.opSeq })).map((m) => m.payload),
    ).toMatchObject([{ layer: "personal", op: "remove", undoOf: applied.payload.opSeq }]);
    expect(bea.since(mark)).toEqual([]);
  });
});

describe("§4.6 idempotency and §4.8 rate limits", () => {
  it("a repeated clientMsgId gets the same answer and is not applied twice", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana"]);
    const [ana] = clients;
    if (!ana) throw new Error();
    const cell = firstEmpty(h, code);
    const first = await ana.send("cell.place", { cell, digit: wrong(h, code, cell) }, "same-id");
    const again = await ana.send("cell.place", { cell, digit: wrong(h, code, cell) }, "same-id");
    expect(again).toEqual(first.concat(first));
    expect(playerIn(h, code, ana.playerId)).toMatchObject({ lives: 2, mistakes: 1 });
  });

  it("more than 40 commands at once get rate_limited, and the bucket refills at 20 per second", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana"]);
    const [ana] = clients;
    if (!ana) throw new Error();
    const cell = firstEmpty(h, code);
    const ids = Array.from({ length: 45 }, (_, i) =>
      ana.post("note.add", { layer: "personal", cell, digit: (i % 9) + 1 }),
    );
    await h.settle();
    const limited = ids.filter((id) => errorOf(ana.replies(id)) === "rate_limited");
    // `room.create` y `match.start` ya gastaron dos de los 40.
    expect(limited.length).toBe(45 - 38);
    await h.advance(1_000);
    expect(
      errorOf(await ana.send("note.remove", { layer: "personal", cell, digit: 1 })),
    ).toBeUndefined();
  });

  it("sys.ping answers sys.pong with t0 and the server time", async () => {
    const h = await createTestServer();
    const client = h.client();
    await client.send("sys.ping", { t0: 42 });
    expect(client.last("sys.pong")?.payload).toEqual({ t0: 42, serverNow: h.clock.now() });
  });
});

describe("E-17 a slow consumer", () => {
  it("above 256 KiB buffered, presence is dropped; above 1 MiB the connection closes with 1013 and a reconnection gets a snapshot", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea?.token) throw new Error();
    bea.link.bufferedAmount = 300 * 1024;
    const mark = bea.mark();
    await ana.send("presence.select", { cell: 3 });
    expect(bea.since(mark)).toEqual([]);
    // Los mensajes del registro no se descartan.
    const cell = firstEmpty(h, code);
    await ana.send("cell.place", { cell, digit: answer(h, code, cell) });
    expect(bea.all("cell.solved", mark)).toHaveLength(1);
    bea.link.bufferedAmount = 2 * 1024 * 1024;
    const next = firstEmpty(h, code);
    await ana.send("cell.place", { cell: next, digit: answer(h, code, next) });
    expect(bea.link.closed?.code).toBe(1013);
    const back = welcomeOf(await h.client().join(code, "Bea", bea.token));
    expect(back.payload.snapshot.match?.locked.map((l) => l.cell)).toEqual(
      expect.arrayContaining([cell, next]),
    );
  });
});
