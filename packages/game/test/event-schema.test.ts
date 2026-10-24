// Esquema de los eventos del registro (ADR 0004): un ejemplo válido y uno inválido por tipo, y todo
// evento que produce una partida en vivo pasa el esquema.
import { describe, expect, it } from "vitest";
import { MATCH_EVENT_TYPES, matchEventSchema, type MatchEventType } from "../src/index.ts";
import { LiveMatch, fixture } from "./helpers/match.ts";

const HASH = "a".repeat(64);
const entry = {
  playerId: "p1",
  nickname: "Inés",
  seat: 0,
  joinedAt: 10,
  tokenHash: HASH,
  connection: "connected",
  autoCleanPersonalNotes: true,
};

const EXAMPLES: Record<MatchEventType, { valid: unknown; invalid: unknown; because: string }> = {
  "match.started": {
    valid: {
      matchId: "m1",
      puzzleId: "z1",
      difficulty: "easy",
      modeId: "normal",
      scoringParamsVersion: "v1",
      hintsTotal: 3,
      starterId: "p1",
      players: [entry],
    },
    invalid: {
      matchId: "m1",
      puzzleId: "z1",
      difficulty: "easy",
      modeId: "normal",
      scoringParamsVersion: "v1",
      hintsTotal: 3,
      starterId: "p1",
      players: [{ ...entry, token: "secret" }],
    },
    because: "a player entry carries a clear token",
  },
  "player.joined": {
    valid: entry,
    invalid: { ...entry, tokenHash: "not-a-hash" },
    because: "tokenHash is not a SHA-256",
  },
  "player.connection": {
    valid: { playerId: "p1", connection: "left", seat: null },
    invalid: { playerId: "p1", connection: "gone", seat: null },
    because: "unknown connection",
  },
  "starter.changed": {
    valid: { playerId: null },
    invalid: {},
    because: "playerId is missing",
  },
  "settings.changed": {
    valid: { playerId: "p1", autoCleanPersonalNotes: false, clientMsgId: "c1" },
    invalid: { playerId: "p1", autoCleanPersonalNotes: false },
    because: "clientMsgId is missing",
  },
  "cell.solved": {
    valid: { playerId: "p1", cell: 4, value: 7, level: 2, graderVersion: "2", clientMsgId: "c1" },
    invalid: { playerId: "p1", cell: 4, value: 7, level: 6, graderVersion: "2", clientMsgId: "c1" },
    because: "level is out of 1..5",
  },
  "cell.mistake": {
    valid: { playerId: "p1", cell: 4, digit: 3, clientMsgId: "c1" },
    invalid: { playerId: "p1", cell: 4, digit: 0, clientMsgId: "c1" },
    because: "digit 0",
  },
  "hint.used": {
    valid: { playerId: "p1", cell: 4, value: 7, clientMsgId: "c1" },
    invalid: { playerId: "p1", cell: -1, value: 7, clientMsgId: "c1" },
    because: "negative cell",
  },
  "note.op": {
    valid: {
      layer: "group",
      ownerId: null,
      playerId: "p1",
      cell: 4,
      digit: 3,
      op: "remove",
      clientMsgId: "c1",
      undoOf: 12,
    },
    invalid: {
      layer: "group",
      ownerId: null,
      playerId: "p1",
      cell: 4,
      digit: 3,
      op: "toggle",
      clientMsgId: "c1",
    },
    because: "there is no toggle (R-16)",
  },
  "match.ended": {
    valid: { result: "victory" },
    invalid: { result: "draw" },
    because: "unknown result",
  },
};

const event = (type: string, payload: unknown) => ({ seq: 3, ts: 1000, type, payload });

describe("match event schema (ADR 0004)", () => {
  it("every event type has examples", () => {
    expect(Object.keys(EXAMPLES).sort()).toEqual([...MATCH_EVENT_TYPES].sort());
  });

  for (const type of MATCH_EVENT_TYPES) {
    const { valid, invalid, because } = EXAMPLES[type];
    it(`${type}: accepts the valid example and rejects one where ${because}`, () => {
      expect(matchEventSchema.safeParse(event(type, valid)).success).toBe(true);
      expect(matchEventSchema.safeParse(event(type, invalid)).success).toBe(false);
    });
  }

  it("rejects an unknown type, seq 0 and extra fields", () => {
    expect(matchEventSchema.safeParse(event("cell.erased", {})).success).toBe(false);
    expect(
      matchEventSchema.safeParse({ ...event("match.ended", { result: "defeat" }), seq: 0 }).success,
    ).toBe(false);
    expect(
      matchEventSchema.safeParse({ ...event("match.ended", { result: "defeat" }), extra: 1 })
        .success,
    ).toBe(false);
  });

  it("every event of a live match passes the schema", () => {
    const live = new LiveMatch(fixture(4), 2);
    const [cell, other] = live.emptyCells();
    if (cell === undefined || other === undefined) throw new Error("No empty cells");
    live.send("p0", "note.add", { layer: "group", cell, digit: 1 });
    live.send("p1", "cell.place", { cell, digit: live.wrong(cell) });
    live.send("p0", "cell.place", { cell, digit: live.answer(cell) });
    live.send("p1", "hint.use", { cell: other });
    live.send("p0", "settings.update", { autoCleanPersonalNotes: false });
    const withHashes = live.log.map((e) =>
      e.type === "match.started"
        ? {
            ...e,
            payload: {
              ...e.payload,
              players: e.payload.players.map((p) => ({ ...p, tokenHash: HASH })),
            },
          }
        : e,
    );
    for (const e of JSON.parse(JSON.stringify(withHashes)) as unknown[]) {
      expect(matchEventSchema.safeParse(e).error).toBeUndefined();
    }
  });
});
