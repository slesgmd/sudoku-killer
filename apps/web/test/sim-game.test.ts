// Una partida completa de un jugador contra el servidor simulado, por el protocolo
// v1 real (esquemas Zod en los dos sentidos) y con el reductor de `@sudoku-killer/game`.
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type SimHarness } from "./helpers/sim.ts";

let harness: SimHarness | null = null;

afterEach(() => {
  harness?.client.destroy();
  harness = null;
});

describe("F8 a full single-player match against the simulated server", () => {
  it("starts, takes a mistake, a note and a hint, and ends in victory", async () => {
    harness = createHarness();
    const { client, settle } = harness;
    client.start("Inés", "easy");
    await settle();
    let state = client.getState();
    expect(state.phase).toBe("playing");
    expect(state.room?.difficulty).toBe("easy");
    expect(state.match?.puzzle.givens.length).toBeGreaterThan(0);

    const solution = harness.solution();
    const empty = () => client.getState().locked.flatMap((cell, i) => (cell ? [] : [i]));
    const [first, second] = empty();
    if (first === undefined || second === undefined) throw new Error("No empty cells");

    // Un error: −1 vida, destello y aviso.
    client.select(first);
    client.input(((solution[first] ?? 1) % 9) + 1);
    await settle();
    state = client.getState();
    expect(state.players[0]).toMatchObject({ lives: 2, mistakes: 1 });
    expect(state.flashes.has(first)).toBe(true);
    expect(state.toasts.at(-1)?.role).toBe("alert");

    // Una nota grupal y una pista.
    client.setMode("notes");
    client.setLayer("group");
    client.input(5);
    await settle();
    expect(client.getState().groupNotes[first]).toBe(1 << 4);
    client.select(second);
    client.useHint();
    await settle();
    expect(client.getState().locked[second]).toMatchObject({ source: "hint" });
    expect(client.getState().match?.hintsLeft).toBe(2);

    // El resto, con la solución.
    client.setMode("number");
    for (const cell of empty()) {
      client.select(cell);
      client.input(solution[cell] ?? 0);
      await settle();
    }
    state = client.getState();
    expect(state.phase).toBe("ended");
    expect(state.match?.result).toBe("victory");
    expect(state.match?.ranking).toHaveLength(1);
    expect(state.room?.state).toBe("finished");
  });
});
