// Reglas del modo Normal sobre el reductor y `decide` (SPEC §6). Son la base U de pruebas que en F9
// se repiten como integración (I) con el servidor real; cada una cita su T.
import { GRADER_VERSION, digitBit, layoutOf, peersWithCage } from "@sudoku-killer/engine";
import { PARAMS_V1 } from "@sudoku-killer/scoring";
import { describe, expect, it } from "vitest";
import { closedUnitsOf } from "../src/index.ts";
import { LiveMatch, fixture } from "./helpers/match.ts";

const EASY = 4;
const { mistakePenalty: P, hintPenalty: H, base: B, weights } = PARAMS_V1;

function match(players = 2): LiveMatch {
  return new LiveMatch(fixture(EASY), players);
}

function firstEmpty(live: LiveMatch): number {
  const cell = live.emptyCells()[0];
  if (cell === undefined) throw new Error("No empty cell");
  return cell;
}

/** Resuelve todas las celdas vacías menos `keep`. */
function solveAllBut(live: LiveMatch, keep: number): void {
  for (const cell of live.emptyCells()) {
    if (cell !== keep) live.send("p0", "cell.place", { cell, digit: live.answer(cell) });
  }
}

describe("R-03 lives (base U of T-03.1–3)", () => {
  it("T-03.1 a wrong digit costs a life and P points, and everybody gets cell.mistake", () => {
    const live = match();
    const cell = firstEmpty(live);
    const digit = live.wrong(cell);
    const decision = live.send("p0", "cell.place", { cell, digit });
    expect(decision.ok).toBe(true);
    const p0 = live.state.players.get("p0");
    expect(p0).toMatchObject({ lives: 2, score: -P, mistakes: 1, role: "active" });
    for (const playerId of ["p0", "p1"]) {
      expect(live.inbox(playerId)).toContainEqual(
        expect.objectContaining({
          type: "cell.mistake",
          payload: { cell, digit, by: "p0", points: -P, score: -P, livesLeft: 2, role: "active" },
        }),
      );
    }
    expect(live.state.cells[cell]).toEqual({ status: "empty" });
    expect(live.state.excluded).toEqual([{ cell, digit }]);
  });

  it("T-03.2 the third mistake makes a spectator who keeps the points", () => {
    const live = match();
    const cell = firstEmpty(live);
    for (const offset of [0, 1, 2]) {
      live.send("p0", "cell.place", { cell, digit: live.wrong(cell, offset) });
    }
    expect(live.state.players.get("p0")).toMatchObject({
      lives: 0,
      role: "spectator",
      score: -3 * P,
    });
  });

  it("T-03.3 a second wrong digit in the same cell is a new mistake", () => {
    const live = match();
    const cell = firstEmpty(live);
    live.send("p0", "cell.place", { cell, digit: live.wrong(cell, 0) });
    live.send("p0", "cell.place", { cell, digit: live.wrong(cell, 1) });
    expect(live.state.players.get("p0")).toMatchObject({ lives: 1, mistakes: 2 });
  });
});

describe("R-05 locked cell and simultaneous moves (base U)", () => {
  it("T-05.1 the second correct move on a cell is already_solved, with no event", () => {
    const live = match();
    const cell = firstEmpty(live);
    live.send("p0", "cell.place", { cell, digit: live.answer(cell) });
    const before = live.state;
    const second = live.send("p1", "cell.place", { cell, digit: live.answer(cell) });
    expect(second).toEqual({
      ok: false,
      reply: { type: "cell.already_solved", payload: { cell } },
    });
    expect(live.state).toBe(before);
    expect(live.log.filter((e) => e.type === "cell.solved")).toHaveLength(1);
  });

  it("T-05.2 a move on a given is already_solved", () => {
    const live = match();
    const given = live.fixture.puzzle.givens[0];
    if (!given) throw new Error("The easy puzzle has givens");
    expect(live.send("p0", "cell.place", { cell: given.cell, digit: given.value })).toMatchObject({
      ok: false,
      reply: { type: "cell.already_solved" },
    });
  });

  it("T-05.3 a wrong digit on a locked cell is already_solved, not a mistake", () => {
    const live = match();
    const cell = firstEmpty(live);
    live.send("p0", "cell.place", { cell, digit: live.answer(cell) });
    const result = live.send("p1", "cell.place", { cell, digit: live.wrong(cell) });
    expect(result).toMatchObject({ ok: false, reply: { type: "cell.already_solved" } });
    expect(live.state.players.get("p1")).toMatchObject({ lives: 3, score: 0 });
  });

  it("T-05.5 a mistake followed by a correct move: two events, the cell gets locked", () => {
    const live = match();
    const cell = firstEmpty(live);
    live.send("p0", "cell.place", { cell, digit: live.wrong(cell) });
    live.send("p1", "cell.place", { cell, digit: live.answer(cell) });
    expect(live.log.slice(1).map((e) => e.type)).toEqual(["cell.mistake", "cell.solved"]);
    expect(live.state.cells[cell]).toMatchObject({ status: "locked", by: "p1" });
  });
});

describe("cell.solved scoring (F6, SPEC §5)", () => {
  it("stores level and grader version, and scores B·w(level) plus β per closed unit", () => {
    const live = match();
    const cell = firstEmpty(live);
    const closed = closedUnitsOf(live.state.puzzle, live.state.cells, cell);
    live.send("p0", "cell.place", { cell, digit: live.answer(cell) });
    const event = live.log.at(-1);
    if (event?.type !== "cell.solved") throw new Error("Expected cell.solved");
    expect(event.payload.graderVersion).toBe(GRADER_VERSION);
    const expected = B * (weights[event.payload.level - 1] ?? 0) + closed.length;
    expect(live.state.players.get("p0")?.score).toBe(expected);
    expect(live.inbox("p1").at(-1)).toMatchObject({
      type: "cell.solved",
      payload: { by: "p0", points: expected, score: expected },
    });
  });
});

describe("R-17 automatic cleanup (base U)", () => {
  it("T-17.1 locking (c, d) removes d from the group notes of its peers and empties c", () => {
    const live = match();
    const cell = firstEmpty(live);
    const digit = live.answer(cell);
    const layout = layoutOf(live.state.puzzle);
    const cage = live.state.puzzle.cages.find((c) => c.cells.includes(cell));
    const peer = peersWithCage(layout, cage, cell).find(
      (p) => live.state.cells[p]?.status === "empty",
    );
    if (peer === undefined) throw new Error("No empty peer");
    live.send("p1", "note.add", { layer: "group", cell: peer, digit });
    live.send("p1", "note.add", { layer: "group", cell, digit });
    live.send("p0", "cell.place", { cell, digit });
    expect((live.state.groupNotes[peer] ?? 0) & digitBit(digit)).toBe(0);
    expect(live.state.groupNotes[cell]).toBe(0);
  });

  it("T-17.2 personal notes are cleaned with the setting on; with it off, only the cell", () => {
    const live = match();
    const cell = firstEmpty(live);
    const digit = live.answer(cell);
    const layout = layoutOf(live.state.puzzle);
    const peer = (layout.peers[cell] ?? []).find((p) => live.state.cells[p]?.status === "empty");
    if (peer === undefined) throw new Error("No empty peer");
    live.send("p1", "settings.update", { autoCleanPersonalNotes: false });
    for (const playerId of ["p0", "p1"]) {
      live.send(playerId, "note.add", { layer: "personal", cell: peer, digit });
      live.send(playerId, "note.add", { layer: "personal", cell, digit });
    }
    live.send("p0", "cell.place", { cell, digit });
    const notes = (id: string) => live.state.players.get(id)?.personalNotes;
    expect((notes("p0")?.[peer] ?? 0) & digitBit(digit)).toBe(0);
    expect((notes("p1")?.[peer] ?? 0) & digitBit(digit)).not.toBe(0);
    expect(notes("p0")?.[cell]).toBe(0);
    expect(notes("p1")?.[cell]).toBe(0);
  });

  it("T-17.3 a mistake cleans nothing", () => {
    const live = match();
    const cell = firstEmpty(live);
    const digit = live.wrong(cell);
    live.send("p1", "note.add", { layer: "group", cell, digit });
    live.send("p0", "cell.place", { cell, digit });
    expect(live.state.groupNotes[cell]).toBe(digitBit(digit));
  });

  it("T-17.4 a hint cleans like a correct move", () => {
    const live = match();
    const cell = firstEmpty(live);
    live.send("p1", "note.add", { layer: "group", cell, digit: live.answer(cell) });
    live.send("p0", "hint.use", { cell });
    expect(live.state.groupNotes[cell]).toBe(0);
  });
});

describe("R-19 hints (base U)", () => {
  it("T-19.1 a hint locks the cell, costs H to who used it and lowers hintsLeft", () => {
    const live = match();
    const cell = firstEmpty(live);
    live.send("p0", "hint.use", { cell });
    expect(live.state.cells[cell]).toMatchObject({
      status: "locked",
      source: "hint",
      by: "p0",
      value: live.answer(cell),
    });
    expect(live.state.hintsLeft).toBe(2);
    expect(live.state.players.get("p0")?.score).toBe(-H);
    expect(live.inbox("p1").at(-1)).toMatchObject({
      type: "hint.used",
      payload: { cell, value: live.answer(cell), by: "p0", points: -H, score: -H, hintsLeft: 2 },
    });
  });

  it("T-19.2 with no hints left, hint.none_left", () => {
    const live = match();
    for (const cell of live.emptyCells().slice(0, 3)) live.send("p0", "hint.use", { cell });
    expect(live.send("p0", "hint.use", { cell: firstEmpty(live) })).toMatchObject({
      ok: false,
      reply: { type: "error", payload: { code: "hint.none_left" } },
    });
  });

  it("T-19.3 a hint on a locked cell is already_solved and does not spend a hint", () => {
    const live = match();
    const cell = firstEmpty(live);
    live.send("p0", "cell.place", { cell, digit: live.answer(cell) });
    expect(live.send("p1", "hint.use", { cell })).toMatchObject({
      ok: false,
      reply: { type: "cell.already_solved" },
    });
    expect(live.state.hintsLeft).toBe(3);
  });

  it("T-19.4 and T-23.2 a spectator can neither use a hint nor place a number", () => {
    const live = match();
    const cell = firstEmpty(live);
    for (const offset of [0, 1, 2])
      live.send("p1", "cell.place", { cell, digit: live.wrong(cell, offset) });
    const forbidden = { ok: false, reply: { type: "error", payload: { code: "forbidden" } } };
    expect(live.send("p1", "hint.use", { cell })).toMatchObject(forbidden);
    expect(live.send("p1", "cell.place", { cell, digit: live.answer(cell) })).toMatchObject(
      forbidden,
    );
    expect(live.state.players.get("p1")).toMatchObject({ lives: 0, score: -3 * P });
  });

  it("T-19.5 a hint that closes a unit gives no β", () => {
    const live = match(1);
    const target = live.emptyCells().at(-1);
    if (target === undefined) throw new Error("No empty cell");
    solveAllBut(live, target);
    const before = live.state.players.get("p0")?.score ?? 0;
    live.send("p0", "hint.use", { cell: target });
    expect(live.state.players.get("p0")?.score).toBe(before - H);
  });
});

describe("R-25 undo notes (base U)", () => {
  function opSeqOf(live: LiveMatch): number {
    const event = live.log.at(-1);
    if (event?.type !== "note.op") throw new Error("Expected note.op");
    return event.seq;
  }

  it("T-25.1 undoing an unchanged group add applies a remove with undoOf, sent to all", () => {
    const live = match();
    const cell = firstEmpty(live);
    live.send("p0", "note.add", { layer: "group", cell, digit: 5 });
    const opSeq = opSeqOf(live);
    live.send("p0", "note.undo", { opSeq });
    expect(live.state.groupNotes[cell]).toBe(0);
    expect(live.inbox("p1").at(-1)).toMatchObject({
      type: "note.applied",
      payload: { layer: "group", op: "remove", cell, digit: 5, by: "p0", undoOf: opSeq },
    });
    expect(live.inbox("p0").at(-1)?.replyTo).toMatch(/^c\d+$/);
  });

  it("T-25.2 if another player changed the candidate later, modified and no change", () => {
    const live = match();
    const cell = firstEmpty(live);
    live.send("p0", "note.add", { layer: "group", cell, digit: 5 });
    const opSeq = opSeqOf(live);
    live.send("p1", "note.remove", { layer: "group", cell, digit: 5 });
    live.send("p1", "note.add", { layer: "group", cell, digit: 5 });
    const before = live.state;
    expect(live.send("p0", "note.undo", { opSeq })).toMatchObject({
      ok: false,
      reply: { type: "error", payload: { code: "undo.not_applicable", reason: "modified" } },
    });
    expect(live.state).toBe(before);
  });

  it("T-25.3 after a cleanup or a lock, modified", () => {
    const live = match();
    const cell = firstEmpty(live);
    live.send("p0", "note.add", { layer: "group", cell, digit: 5 });
    const opSeq = opSeqOf(live);
    live.send("p1", "cell.place", { cell, digit: live.answer(cell) });
    expect(live.send("p0", "note.undo", { opSeq })).toMatchObject({
      reply: { payload: { code: "undo.not_applicable", reason: "modified" } },
    });
  });

  it("T-25.4 undoing another player's operation is not_owner", () => {
    const live = match();
    live.send("p0", "note.add", { layer: "group", cell: firstEmpty(live), digit: 5 });
    expect(live.send("p1", "note.undo", { opSeq: opSeqOf(live) })).toMatchObject({
      reply: { payload: { code: "undo.not_applicable", reason: "not_owner" } },
    });
    expect(live.send("p1", "note.undo", { opSeq: 999 })).toMatchObject({
      reply: { payload: { code: "undo.not_applicable", reason: "unknown_op" } },
    });
  });

  it("T-25.5 and R-29 personal notes and their undo reach only the owner", () => {
    const live = match();
    const cell = firstEmpty(live);
    const from = live.sent.length;
    live.send("p0", "note.add", { layer: "personal", cell, digit: 7 });
    live.send("p0", "note.undo", { opSeq: opSeqOf(live) });
    expect(live.inbox("p1", from)).toEqual([]);
    expect(live.inbox("p0", from).map((m) => m.type)).toEqual(["note.applied", "note.applied"]);
    expect(live.state.players.get("p0")?.personalNotes[cell]).toBe(0);
  });

  it("T-16.3 adding a candidate that is already there is ack{applied:false} with no event", () => {
    const live = match();
    const cell = firstEmpty(live);
    live.send("p0", "note.add", { layer: "group", cell, digit: 5 });
    const events = live.log.length;
    expect(live.send("p1", "note.add", { layer: "group", cell, digit: 5 })).toEqual({
      ok: false,
      reply: { type: "ack", payload: { applied: false } },
    });
    expect(live.log).toHaveLength(events);
  });

  it("a note on a locked cell is cell.locked (T-15.2)", () => {
    const live = match();
    const cell = firstEmpty(live);
    live.send("p0", "cell.place", { cell, digit: live.answer(cell) });
    expect(live.send("p1", "note.add", { layer: "group", cell, digit: 1 })).toMatchObject({
      reply: { payload: { code: "cell.locked" } },
    });
  });
});

describe("R-01 group result (base U)", () => {
  it("T-01.1 solving the last empty cell sends cell.solved and then match.ended{victory}", () => {
    const live = match();
    const last = live.emptyCells().at(-1);
    if (last === undefined) throw new Error("No empty cell");
    solveAllBut(live, last);
    live.send("p1", "cell.place", { cell: last, digit: live.answer(last) });
    expect(
      live
        .inbox("p0")
        .slice(-2)
        .map((m) => m.type),
    ).toEqual(["cell.solved", "match.ended"]);
    expect(live.state).toMatchObject({ result: "victory", endedAt: live.now });
    expect(live.send("p0", "note.add", { layer: "group", cell: 0, digit: 1 })).toMatchObject({
      reply: { payload: { code: "match.not_running" } },
    });
  });

  it("T-01.2 the only active player losing the last life ends in defeat", () => {
    const live = match(1);
    const cell = firstEmpty(live);
    for (const offset of [0, 1, 2])
      live.send("p0", "cell.place", { cell, digit: live.wrong(cell, offset) });
    expect(live.state.result).toBe("defeat");
    expect(live.inbox("p0").at(-1)).toMatchObject({
      type: "match.ended",
      payload: { result: "defeat", ranking: [{ playerId: "p0", position: 1, score: -3 * P }] },
    });
  });

  it("T-01.5 a hint on the last empty cell is a victory", () => {
    const live = match(1);
    const last = live.emptyCells().at(-1);
    if (last === undefined) throw new Error("No empty cell");
    solveAllBut(live, last);
    live.send("p0", "hint.use", { cell: last });
    expect(live.state.result).toBe("victory");
  });
});
