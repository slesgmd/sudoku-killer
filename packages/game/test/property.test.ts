// Propiedades del reductor sobre partidas aleatorias de varios jugadores (aciertos, errores, pistas,
// notas, deshacer, ajustes, entradas y desconexiones).
// - T-15.1: una celda `locked` nunca cambia de valor ni vuelve a `empty`.
// - T-32.1 (base): el estado en vivo (`decide` + `applyWithEffects` paso a paso) es igual a
//   `replay(registro)`, y los puntajes coinciden con `scoreLog` sobre los hechos. Se repite
//   contra el servidor real.
import fc from "fast-check";
import { PARAMS_V1, scoreLog, type ScoringEvent } from "@sudoku-killer/scoring";
import { describe, expect, it } from "vitest";
import {
  apply,
  closedUnitsOf,
  decideConnection,
  decideJoin,
  initialState,
  replay,
  type MatchEvent,
  type MatchState,
} from "../src/index.ts";
import { assertProperty } from "../../engine/test/helpers/property.ts";
import { LiveMatch, entry, fixture, mode } from "./helpers/match.ts";

const SEEDS = [4, 1] as const; // fácil y media
const MAX_PLAYERS = 4;

const actionArb = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant("place" as const),
      player: fc.nat(MAX_PLAYERS - 1),
      pick: fc.nat(),
      correct: fc.boolean(),
      offset: fc.nat(7),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("hint" as const),
      player: fc.nat(MAX_PLAYERS - 1),
      pick: fc.nat(),
    }),
  },
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant("note" as const),
      player: fc.nat(MAX_PLAYERS - 1),
      add: fc.boolean(),
      group: fc.boolean(),
      pick: fc.nat(),
      digit: fc.integer({ min: 1, max: 9 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("undo" as const),
      player: fc.nat(MAX_PLAYERS - 1),
      back: fc.nat(3),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("settings" as const),
      player: fc.nat(MAX_PLAYERS - 1),
      on: fc.boolean(),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("join" as const) }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("connection" as const),
      player: fc.nat(MAX_PLAYERS - 1),
      connection: fc.constantFrom("connected", "disconnected", "expired", "left"),
    }),
  },
);

type Action = typeof actionArb extends fc.Arbitrary<infer A> ? A : never;

function play(
  seed: number,
  players: number,
  actions: readonly Action[],
  check: (before: MatchState, after: MatchState) => void,
): LiveMatch {
  const live = new LiveMatch(fixture(seed), players);
  const ids = () => [...live.state.players.keys()];
  const idOf = (index: number) => ids()[index % ids().length] ?? "p0";
  const ownOps = new Map<string, number[]>();
  for (const action of actions) {
    if (live.state.endedAt !== null) break;
    const before = live.state;
    const pickCell = (pick: number, onlyEmpty: boolean) => {
      const pool = onlyEmpty ? live.emptyCells() : live.state.cells.map((_, i) => i);
      return pool[pick % Math.max(1, pool.length)] ?? 0;
    };
    switch (action.kind) {
      case "place": {
        const cell = pickCell(action.pick, action.correct);
        const digit = action.correct ? live.answer(cell) : live.wrong(cell, action.offset);
        live.send(idOf(action.player), "cell.place", { cell, digit });
        break;
      }
      case "hint":
        live.send(idOf(action.player), "hint.use", { cell: pickCell(action.pick, true) });
        break;
      case "note": {
        const playerId = idOf(action.player);
        const decision = live.send(playerId, action.add ? "note.add" : "note.remove", {
          layer: action.group ? "group" : "personal",
          cell: pickCell(action.pick, true),
          digit: action.digit,
        });
        const event = decision.ok ? decision.events[0] : undefined;
        if (event?.type === "note.op")
          ownOps.set(playerId, [...(ownOps.get(playerId) ?? []), event.seq]);
        break;
      }
      case "undo": {
        const playerId = idOf(action.player);
        const ops = ownOps.get(playerId) ?? [];
        const opSeq = ops[ops.length - 1 - (action.back % Math.max(1, ops.length))] ?? 1;
        live.send(playerId, "note.undo", { opSeq });
        break;
      }
      case "settings":
        live.send(idOf(action.player), "settings.update", { autoCleanPersonalNotes: action.on });
        break;
      case "join": {
        if (live.state.players.size >= mode.rules.maxSeats) break;
        live.now += 10;
        live.commit(
          decideJoin(live.state, entry(live.state.players.size, live.now), mode, live.now),
        );
        break;
      }
      case "connection": {
        const playerId = idOf(action.player);
        const seat = live.state.players.get(playerId)?.seat ?? null;
        const connection = action.connection;
        const keepsSeat = connection === "connected" || connection === "disconnected";
        live.now += 10;
        live.commit(
          decideConnection(
            live.state,
            { playerId, connection, seat: keepsSeat ? seat : null },
            mode,
            live.now,
          ),
        );
        break;
      }
    }
    check(before, live.state);
  }
  return live;
}

/** Hechos que puntúan, con su contexto (nivel guardado y unidades cerradas antes de la jugada). */
function scoringFacts(log: readonly MatchEvent[], puzzle: MatchState["puzzle"]): ScoringEvent[] {
  const [first, ...rest] = log;
  if (first?.type !== "match.started") throw new Error("Bad log");
  let state = initialState(first, { mode, puzzle });
  const facts: ScoringEvent[] = [];
  for (const event of rest) {
    if (event.type === "cell.solved") {
      const { playerId, cell, level } = event.payload;
      const closedUnits = closedUnitsOf(puzzle, state.cells, cell);
      facts.push({
        type: "correct",
        playerId,
        cell,
        at: event.ts,
        levelToDeduce: level,
        closedUnits,
      });
    } else if (event.type === "cell.mistake") {
      const { playerId, cell, digit } = event.payload;
      facts.push({ type: "mistake", playerId, cell, digit, at: event.ts });
    } else if (event.type === "hint.used") {
      const { playerId, cell } = event.payload;
      facts.push({ type: "hint", playerId, cell, at: event.ts });
    }
    state = apply(state, event, { mode, puzzle });
  }
  return facts;
}

const gameArb = fc.record({
  seed: fc.constantFrom(...SEEDS),
  players: fc.integer({ min: 1, max: MAX_PLAYERS }),
  actions: fc.array(actionArb, { minLength: 1, maxLength: 80 }),
});

describe("T-15.1 a locked cell stays locked with the same value", () => {
  it("for any sequence of commands", () => {
    assertProperty(
      fc.property(gameArb, ({ seed, players, actions }) => {
        play(seed, players, actions, (before, after) => {
          before.cells.forEach((cell, i) => {
            if (cell.status === "locked") expect(after.cells[i]).toEqual(cell);
          });
        });
      }),
      { numRuns: 40 },
    );
  });
});

describe("T-32.1 (base) replay of the log equals the live state", () => {
  it("cells, notes, lives, roles, scores, ranking and note history match", () => {
    assertProperty(
      fc.property(gameArb, ({ seed, players, actions }) => {
        const live = play(seed, players, actions, () => undefined);
        const replayed = replay(live.log, { mode, puzzle: live.fixture.puzzle });
        expect(replayed).toEqual(live.state);
        expect(mode.ranking(replayed)).toEqual(mode.ranking(live.state));

        const tallies = scoreLog(scoringFacts(live.log, live.fixture.puzzle), PARAMS_V1, [
          ...replayed.players.keys(),
        ]);
        for (const [playerId, player] of replayed.players) {
          expect(tallies.get(playerId)).toEqual({
            score: player.score,
            mistakes: player.mistakes,
            scoreReachedAt: player.scoreReachedAt,
          });
        }
      }),
      { numRuns: 40 },
    );
  });
});

describe("R-31 the solution never reaches a message", () => {
  it("no message carries a solution field or the serialized solution", () => {
    assertProperty(
      fc.property(gameArb, ({ seed, players, actions }) => {
        const live = play(seed, players, actions, () => undefined);
        const solution = live.fixture.solution;
        for (const { envelope } of live.sent) {
          const text = JSON.stringify(envelope);
          expect(text).not.toMatch(/"solution"/);
          expect(text).not.toContain(solution.join(""));
          expect(text).not.toContain(JSON.stringify(solution));
        }
      }),
      { numRuns: 20 },
    );
  });
});
