// Bot compañero (F8f): juega por el protocolo v1 contra el servidor simulado, sin ver la solución,
// con semilla, ritmo configurable y errores a propósito.
import { createRng } from "@sudoku-killer/engine";
import { regenerateSeed } from "@sudoku-killer/bank";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Bot, chooseMove, type BotBoard } from "../src/dev/bot/bot.ts";
import { createSimTransport } from "../src/dev/sim/transport.ts";
import { createHarness, type SimHarness } from "./helpers/sim.ts";

let harness: SimHarness | null = null;
let bot: Bot | null = null;

afterEach(() => {
  bot?.stop();
  harness?.client.destroy();
  bot = null;
  harness = null;
});

function boardOf(seed: number): { board: BotBoard; solution: readonly number[] } {
  const { generated } = regenerateSeed(seed);
  const { puzzle, solution } = generated;
  const values = new Array<number>(solution.length).fill(0);
  for (const { cell, value } of puzzle.givens) values[cell] = value;
  const board: BotBoard = {
    puzzle: {
      id: "p",
      size: puzzle.size,
      boxRows: puzzle.boxRows,
      boxCols: puzzle.boxCols,
      difficulty: "easy",
      cages: puzzle.cages.map(({ id, cells, sum }) => ({ id, cells: [...cells], sum })),
      givens: puzzle.givens.map(({ cell, value }) => ({ cell, value })),
    },
    values,
    excluded: [],
  };
  return { board, solution };
}

describe("F8f chooseMove", () => {
  it("deduces the solution digit from public information only, and is deterministic", () => {
    const { board, solution } = boardOf(4);
    for (let step = 0; step < 20; step++) {
      const a = chooseMove(board, createRng(step), 0);
      const b = chooseMove(board, createRng(step), 0);
      expect(a).toEqual(b);
      if (!a) throw new Error("No move");
      expect(a.mistake).toBe(false);
      expect(a.digit).toBe(solution[a.cell]);
      board.values[a.cell] = a.digit;
    }
  });

  it("with errorRate 1 it always picks a wrong digit", () => {
    const { board, solution } = boardOf(4);
    const move = chooseMove(board, createRng(9), 1);
    expect(move?.mistake).toBe(true);
    expect(move?.digit).not.toBe(move ? solution[move.cell] : undefined);
  });
});

async function startWithBot(errorRate: number): Promise<SimHarness> {
  const created = createHarness();
  created.client.start("Inés", "easy");
  await created.settle();
  const code = created.client.getState().room?.code;
  if (!code) throw new Error("No room");
  bot = new Bot({
    transport: createSimTransport(created.server),
    code,
    nickname: "Tomás",
    seed: 7,
    paceMs: 2,
    errorRate,
  });
  return created;
}

describe("F8f the bot plays through the protocol", () => {
  it("joins the match, shows its presence and notes, and solves the board", async () => {
    harness = await startWithBot(0);
    const { client } = harness;
    const seen = new Set<string>();
    const tomasId = () => client.getState().players.find((p) => p.nickname === "Tomás")?.id;
    await vi.waitFor(
      () => {
        const state = client.getState();
        const id = tomasId();
        if (id && state.presence.has(id)) seen.add("presence");
        if (state.groupNotes.some((mask) => mask !== 0)) seen.add("note");
        expect(state.phase).toBe("ended");
      },
      { timeout: 30_000, interval: 5 },
    );
    const state = client.getState();
    expect(state.match?.result).toBe("victory");
    expect(state.locked.every((cell) => cell !== null)).toBe(true);
    expect(state.locked.some((cell) => cell?.by === tomasId())).toBe(true);
    expect(seen.has("presence")).toBe(true);
  });

  it("makes mistakes on purpose and stops when it runs out of lives", async () => {
    harness = await startWithBot(1);
    const { client } = harness;
    await vi.waitFor(
      () => {
        const tomas = client.getState().players.find((p) => p.nickname === "Tomás");
        expect(tomas).toMatchObject({ lives: 0, role: "spectator", mistakes: 3 });
      },
      { timeout: 10_000, interval: 5 },
    );
    expect(client.getState().phase).toBe("playing");
    expect(client.getState().activity.filter((e) => e.kind === "mistake")).toHaveLength(3);
  });
});
