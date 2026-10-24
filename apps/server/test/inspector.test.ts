// Control del inspector de filtración (SPEC §8.3): cada regla tiene que detectar su caso, y un
// mensaje limpio no deja violaciones. Si el inspector no detectara nada, las pruebas I no probarían
// T-31.1 ni T-29.1.
import { describe, expect, it } from "vitest";
import { LeakInspector } from "./helpers/inspector.ts";

const SOLUTION = Array.from({ length: 81 }, (_, i) => (i % 9) + 1);
const ME = "p-me";

function inspector() {
  const locked = new Map<number, number>([[0, 1]]);
  const inspect = new LeakInspector({
    solutions: () => [SOLUTION],
    lockedValue: (matchId, cell) => (matchId === "m1" ? locked.get(cell) : undefined),
  });
  // El cliente 1 es `ME`, en la partida `m1`.
  const snapshot = {
    serverNow: 1,
    atSeq: 1,
    room: { code: "ABCDEF", state: "running", starterId: ME, difficulty: "easy", players: [] },
    match: {
      id: "m1",
      puzzle: {
        id: "z",
        size: 9,
        boxRows: 3,
        boxCols: 3,
        difficulty: "easy",
        cages: [],
        givens: [],
      },
      startedAt: 1,
      endedAt: null,
      result: null,
      hintsLeft: 3,
      locked: [],
      groupNotes: [],
      ranking: null,
    },
    you: { playerId: ME, settings: { autoCleanPersonalNotes: true }, personalNotes: [] },
  };
  inspect.check(
    1,
    JSON.stringify({ v: 1, type: "room.welcome", payload: { playerId: ME, token: "t", snapshot } }),
  );
  return inspect;
}

const send = (inspect: LeakInspector, message: object) => {
  inspect.check(1, JSON.stringify(message));
  return inspect.violations;
};

describe("leak inspector control (T-31.1, T-29.1)", () => {
  it("a clean welcome with its own token and a revealed value pass", () => {
    const inspect = inspector();
    send(inspect, {
      v: 1,
      type: "cell.solved",
      payload: { cell: 0, value: 1, by: ME, points: 10, score: 10, bonuses: [] },
    });
    expect(inspect.violations).toEqual([]);
  });

  it("1. a solution, tokenHash or token key outside the owner's welcome", () => {
    expect(
      send(inspector(), { v: 1, type: "ack", payload: { applied: true, solution: [] } }),
    ).toHaveLength(1);
    expect(
      send(inspector(), { v: 1, type: "ack", payload: { applied: true, tokenHash: "x" } }),
    ).toHaveLength(1);
    const joined = send(inspector(), {
      v: 1,
      type: "room.player_joined",
      payload: { player: {}, token: "t" },
    });
    expect(joined.filter((v) => v.includes("forbidden key: .payload.token"))).toHaveLength(1);
  });

  it("2. the solution serialized as 81 digits or as a JSON array", () => {
    const inspect = inspector();
    send(inspect, {
      v: 1,
      type: "error",
      payload: { code: "bad_request", reason: SOLUTION.join("") },
    });
    send(inspect, { v: 1, type: "ack", payload: { applied: true, x: SOLUTION } });
    expect(inspect.violations.filter((v) => v.includes("serialized solution"))).toHaveLength(2);
  });

  it("3. a value on a cell that is not locked with that value", () => {
    const inspect = inspector();
    send(inspect, {
      v: 1,
      type: "cell.solved",
      payload: { cell: 5, value: 6, by: ME, points: 1, score: 1, bonuses: [] },
    });
    send(inspect, {
      v: 1,
      type: "hint.used",
      payload: { cell: 0, value: 2, by: ME, points: -60, score: -60, hintsLeft: 2 },
    });
    expect(inspect.violations.filter((v) => v.includes(": value:"))).toHaveLength(2);
  });

  it("4. personal notes of another player", () => {
    const inspect = inspector();
    send(inspect, {
      v: 1,
      type: "note.applied",
      payload: { opSeq: 3, layer: "personal", op: "add", cell: 4, digit: 2, by: "p-other" },
    });
    expect(inspect.violations).toHaveLength(1);
    expect(inspect.violations[0]).toMatch(/personal notes/);
  });

  it("messages that do not follow the protocol schema", () => {
    expect(send(inspector(), { v: 1, type: "cell.erased", payload: {} })[0]).toMatch(/schema/);
  });
});
