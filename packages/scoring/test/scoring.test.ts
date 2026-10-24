// Puntuación (F6, `docs/puntuacion.md`). T-02.1 a T-02.3: orden del ranking. T-19.5: una pista no da
// β. T-32.4: recalcular con otros parámetros no toca el registro. T-36.1 a T-36.5: determinismo,
// cotas, monotonía, independencia del orden de los hechos que no se afectan y firmas de GameMode.
import fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import { MAX_TECHNIQUE_LEVEL } from "@sudoku-killer/engine";
import {
  PARAMS_V1,
  SCORED_LEVELS,
  createScoring,
  parseScoringParams,
  pointsFor,
  rankPlayers,
  scoreLog,
  type ClosedUnit,
  type ScoringEvent,
  type ScoringParams,
} from "@sudoku-killer/scoring";
import { assertProperty } from "../../engine/test/helpers/property.ts";

const UNITS = ["row", "col", "box", "cage"] as const;
const playerArb = fc.constantFrom("ana", "beto", "caro", "dani");
const levelArb = fc.integer({ min: 1, max: SCORED_LEVELS });
const closedArb: fc.Arbitrary<ClosedUnit[]> = fc.uniqueArray(
  fc.record({ unit: fc.constantFrom(...UNITS), index: fc.nat({ max: 8 }) }),
  { maxLength: 4, selector: ({ unit }) => unit },
);
const eventArb: fc.Arbitrary<ScoringEvent> = fc.oneof(
  fc.record({
    type: fc.constant("correct" as const),
    playerId: playerArb,
    cell: fc.nat({ max: 80 }),
    at: fc.nat({ max: 3_600_000 }),
    levelToDeduce: levelArb,
    closedUnits: closedArb,
  }),
  fc.record({
    type: fc.constant("mistake" as const),
    playerId: playerArb,
    cell: fc.nat({ max: 80 }),
    digit: fc.integer({ min: 1, max: 9 }),
    at: fc.nat({ max: 3_600_000 }),
  }),
  fc.record({
    type: fc.constant("hint" as const),
    playerId: playerArb,
    cell: fc.nat({ max: 80 }),
    at: fc.nat({ max: 3_600_000 }),
  }),
);

/** Otros parámetros válidos, para T-32.4. */
const OTHER: ScoringParams = parseScoringParams({
  ...PARAMS_V1,
  version: "test",
  weights: [1, 2, 3, 4, 6],
  mistakePenalty: 80,
});

describe("params", () => {
  it("v1 is valid, frozen, and scores the engine's levels", () => {
    expect(SCORED_LEVELS).toBe(MAX_TECHNIQUE_LEVEL);
    expect(PARAMS_V1.version).toBe("v1");
    expect(Object.isFrozen(PARAMS_V1)).toBe(true);
  });

  it("rejects decreasing weights, non-integer points and negative penalties", () => {
    const base = { ...PARAMS_V1 };
    expect(() => parseScoringParams({ ...base, weights: [1, 2, 1.5, 3, 4] })).toThrow();
    expect(() => parseScoringParams({ ...base, weights: [1, 1.25, 2, 3, 4] })).toThrow();
    expect(() => parseScoringParams({ ...base, weights: [1, 2, 3, 4] })).toThrow();
    expect(() => parseScoringParams({ ...base, mistakePenalty: -1 })).toThrow();
    expect(() => parseScoringParams({ ...base, base: 0 })).toThrow();
  });

  it("pointsFor rejects levels outside 1 to 5 (UNRATED never scores)", () => {
    for (const level of [0, 6, 1.5, -1]) {
      expect(() => pointsFor(level, PARAMS_V1)).toThrow(RangeError);
    }
  });
});

describe("events", () => {
  const scoring = createScoring(PARAMS_V1);

  it("T-36.2: a correct cell gives between B·w(1) and B·w(5) + 4β; a mistake −P; a hint −H", () => {
    const { base, weights, closureBonus, mistakePenalty, hintPenalty } = PARAMS_V1;
    const min = base * (weights[0] ?? 0);
    const max = base * (weights[SCORED_LEVELS - 1] ?? 0) + 4 * closureBonus;
    assertProperty(
      fc.property(levelArb, closedArb, fc.nat(), (level, closedUnits, cell) => {
        const changes = scoring.onCorrect({
          playerId: "ana",
          cell,
          at: 0,
          levelToDeduce: level,
          closedUnits,
        });
        const total = changes.reduce((sum, { delta }) => sum + delta, 0);
        expect(total).toBeGreaterThanOrEqual(min);
        expect(total).toBeLessThanOrEqual(max);
        expect(changes.map(({ reason }) => reason)).toEqual([
          "correct",
          ...closedUnits.map(() => "closure"),
        ]);
        expect(new Set(changes.map(({ playerId }) => playerId))).toEqual(new Set(["ana"]));
      }),
    );
    expect(scoring.onMistake({ playerId: "ana", cell: 0, digit: 3, at: 0 })).toEqual({
      score: [{ playerId: "ana", delta: -mistakePenalty, reason: "mistake" }],
      livesDelta: -1,
    });
    expect(scoring.onHint({ playerId: "ana", cell: 0, at: 0 })).toEqual([
      { playerId: "ana", delta: -hintPenalty, reason: "hint" },
    ]);
  });

  it("T-19.5: a hint that closes units gives no β to anyone", () => {
    const closedUnits: ClosedUnit[] = UNITS.map((unit) => ({ unit, index: 0 }));
    // El contexto de una pista es un PlacementContext: trae las unidades que cierra.
    const context = { playerId: "ana", cell: 0, at: 0, closedUnits };
    const changes = scoring.onHint(context);
    expect(changes).toEqual([{ playerId: "ana", delta: -PARAMS_V1.hintPenalty, reason: "hint" }]);
  });

  it("T-36.3: more correct cells of a level give more points, and a higher level no fewer", () => {
    assertProperty(
      fc.property(levelArb, levelArb, fc.nat({ max: 40 }), fc.nat({ max: 40 }), (a, b, m, n) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        const [few, many] = m <= n ? [m, n] : [n, m];
        const run = (level: number, count: number) =>
          scoreLog(
            Array.from({ length: count }, (_, i) => ({
              type: "correct" as const,
              playerId: "ana",
              cell: i,
              at: i,
              levelToDeduce: level,
              closedUnits: [],
            })),
            PARAMS_V1,
            ["ana"],
          ).get("ana")?.score ?? NaN;
        if (few < many) expect(run(low, many)).toBeGreaterThan(run(low, few));
        expect(run(high, many)).toBeGreaterThanOrEqual(run(low, many));
      }),
    );
  });
});

describe("scoreLog", () => {
  it("T-36.1: deterministic, on copies too, and the log is left untouched", () => {
    assertProperty(
      fc.property(fc.array(eventArb, { maxLength: 60 }), (events) => {
        const frozen = Object.freeze(events.map((event) => Object.freeze({ ...event })));
        const first = scoreLog(frozen, PARAMS_V1);
        expect(scoreLog(frozen, PARAMS_V1)).toEqual(first);
        expect(scoreLog(structuredClone(events), PARAMS_V1)).toEqual(first);
      }),
    );
  });

  it("tallies points, mistakes and the last score change", () => {
    const events: ScoringEvent[] = [
      { type: "correct", playerId: "ana", cell: 0, at: 10, levelToDeduce: 3, closedUnits: [] },
      { type: "mistake", playerId: "beto", cell: 1, digit: 4, at: 20 },
      {
        type: "correct",
        playerId: "ana",
        cell: 2,
        at: 30,
        levelToDeduce: 1,
        closedUnits: [{ unit: "row", index: 0 }],
      },
      { type: "hint", playerId: "beto", cell: 3, at: 40 },
    ];
    const tallies = scoreLog(events, PARAMS_V1, ["ana", "beto", "caro"]);
    expect(tallies.get("ana")).toEqual({ score: 30 + 10 + 1, mistakes: 0, scoreReachedAt: 30 });
    expect(tallies.get("beto")).toEqual({ score: -90 - 60, mistakes: 1, scoreReachedAt: 40 });
    expect(tallies.get("caro")).toEqual({ score: 0, mistakes: 0, scoreReachedAt: null });
  });

  it("T-36.4: reordering facts that do not affect each other changes nothing", () => {
    // Los contextos (nivel y unidades cerradas) y el `at` viajan con cada hecho, como en el
    // registro: cualquier permutación da los mismos puntajes, errores y `scoreReachedAt`.
    assertProperty(
      fc.property(
        fc
          .array(eventArb, { maxLength: 40 })
          .chain((events) =>
            fc.tuple(
              fc.constant(events),
              fc.shuffledSubarray(events, { minLength: events.length }),
            ),
          ),
        ([events, shuffled]) => {
          expect(scoreLog(shuffled, PARAMS_V1)).toEqual(scoreLog(events, PARAMS_V1));
        },
      ),
    );
  });

  it("T-32.4: rescoring with other params changes the scores, not the log", () => {
    const events: ScoringEvent[] = [
      { type: "correct", playerId: "ana", cell: 0, at: 1, levelToDeduce: 5, closedUnits: [] },
      { type: "mistake", playerId: "ana", cell: 1, digit: 2, at: 2 },
    ];
    const before = structuredClone(events);
    const v1 = scoreLog(Object.freeze(events), PARAMS_V1).get("ana");
    const other = scoreLog(Object.freeze(events), OTHER).get("ana");
    expect(v1?.score).toBe(50 - 90);
    expect(other?.score).toBe(60 - 80);
    expect(events).toEqual(before);
  });
});

describe("ranking", () => {
  const entry = (
    playerId: string,
    score: number,
    mistakes = 0,
    scoreReachedAt: number | null = 0,
    nickname = playerId,
  ) => ({ playerId, nickname, score, mistakes, scoreReachedAt });

  it("T-02.1: orders by score, descending", () => {
    const ranked = rankPlayers([entry("a", 10), entry("b", 30), entry("c", 20)]);
    expect(ranked.map(({ playerId, position }) => [playerId, position])).toEqual([
      ["b", 1],
      ["c", 2],
      ["a", 3],
    ]);
  });

  it("T-02.2: at equal score, fewer mistakes first", () => {
    const ranked = rankPlayers([entry("a", 10, 2), entry("b", 10, 1)]);
    expect(ranked.map(({ playerId, position }) => [playerId, position])).toEqual([
      ["b", 1],
      ["a", 2],
    ]);
  });

  it("T-02.3: at equal score and mistakes, the earlier scoreReachedAt first", () => {
    const ranked = rankPlayers([
      entry("a", 10, 1, 500),
      entry("b", 10, 1, 300),
      entry("c", 10, 1, null),
    ]);
    expect(ranked.map(({ playerId, position }) => [playerId, position])).toEqual([
      ["b", 1],
      ["a", 2],
      ["c", 3],
    ]);
  });

  it("a full tie shares the position and is shown by nickname", () => {
    const ranked = rankPlayers([
      entry("p1", 10, 0, 5, "Zoe"),
      entry("p2", 10, 0, 5, "ana"),
      entry("p3", 5, 0, 5, "Beto"),
    ]);
    expect(ranked.map(({ nickname, position }) => [nickname, position])).toEqual([
      ["ana", 1],
      ["Zoe", 1],
      ["Beto", 3],
    ]);
  });

  it("does not depend on the input order", () => {
    assertProperty(
      fc.property(
        fc.uniqueArray(
          fc.record({
            playerId: fc.string({ minLength: 1, maxLength: 4 }),
            nickname: fc.string({ minLength: 2, maxLength: 6 }),
            score: fc.integer({ min: -200, max: 200 }),
            mistakes: fc.nat({ max: 3 }),
            scoreReachedAt: fc.option(fc.nat({ max: 10 })),
          }),
          { selector: ({ playerId }) => playerId, maxLength: 6 },
        ),
        fc.nat(),
        (entries, shift) => {
          const k = entries.length === 0 ? 0 : shift % entries.length;
          const rotated = [...entries.slice(k), ...entries.slice(0, k)];
          expect(rankPlayers(rotated)).toEqual(rankPlayers(entries));
        },
      ),
    );
  });
});

describe("T-36.5: the GameMode signatures of SPEC §5", () => {
  // Copia literal de los tipos de la SPEC §5 que tocan la puntuación. `MatchState` y `PlayerId`
  // llegan en F9; aquí son marcadores.
  type PlayerId = string & { readonly __brand: "PlayerId" };
  interface MatchState {
    readonly cells: readonly unknown[];
  }
  interface Bonus {
    unit: "row" | "col" | "box" | "cage";
    index: number;
    points: number;
  }
  interface PlacementContext {
    state: Readonly<MatchState>;
    playerId: PlayerId;
    cell: number;
    value: number;
    at: number;
    closedUnits: { unit: Bonus["unit"]; index: number }[];
    levelToDeduce: number;
  }
  interface ScoreChange {
    playerId: PlayerId;
    delta: number;
    reason: "correct" | "closure" | "mistake" | "hint";
  }
  interface GameModeScoring {
    onCorrect(ctx: PlacementContext): ScoreChange[];
    onMistake(ctx: {
      state: MatchState;
      playerId: PlayerId;
      cell: number;
      digit: number;
      at: number;
    }): {
      score: ScoreChange[];
      livesDelta: number;
    };
    onHint(ctx: PlacementContext): ScoreChange[];
  }

  it("createScoring fits GameMode without adapting", () => {
    expectTypeOf(createScoring(PARAMS_V1)).toExtend<GameModeScoring>();
    const mode: GameModeScoring = createScoring(PARAMS_V1);
    expect(typeof mode.onCorrect).toBe("function");
  });
});
