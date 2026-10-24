// Un ejemplo válido y uno inválido de cada mensaje de los catálogos de SPEC §4.2 y §4.3 (§8.4).
import type { ClientMessageType, ServerMessageType } from "../src/index.ts";

interface Example {
  readonly valid: unknown;
  /** Qué rompe el inválido, para el nombre de la prueba. */
  readonly invalidBecause: string;
  readonly invalid: unknown;
}

export const CLIENT_EXAMPLES: Record<ClientMessageType, Example> = {
  "room.create": {
    valid: { nickname: "Inés" },
    invalidBecause: "nickname is not a string",
    invalid: { nickname: 7 },
  },
  "room.join": {
    valid: { code: "HPQ6NZ", nickname: "Tomás", token: "abc" },
    invalidBecause: "code is missing",
    invalid: { nickname: "Tomás" },
  },
  "room.leave": { valid: {}, invalidBecause: "extra field", invalid: { force: true } },
  "room.set_difficulty": {
    valid: { difficulty: "hard" },
    invalidBecause: "unknown difficulty",
    invalid: { difficulty: "insane" },
  },
  "room.reset": { valid: {}, invalidBecause: "extra field", invalid: { keep: 1 } },
  "match.start": { valid: {}, invalidBecause: "extra field", invalid: { puzzleId: "x" } },
  "cell.place": {
    valid: { cell: 80, digit: 9 },
    invalidBecause: "digit 0",
    invalid: { cell: 3, digit: 0 },
  },
  "hint.use": { valid: { cell: 0 }, invalidBecause: "negative cell", invalid: { cell: -1 } },
  "note.add": {
    valid: { layer: "group", cell: 10, digit: 2 },
    invalidBecause: "unknown layer",
    invalid: { layer: "team", cell: 10, digit: 2 },
  },
  "note.remove": {
    valid: { layer: "personal", cell: 10, digit: 2 },
    invalidBecause: "fractional digit",
    invalid: { layer: "personal", cell: 10, digit: 2.5 },
  },
  "note.undo": { valid: { opSeq: 12 }, invalidBecause: "opSeq 0", invalid: { opSeq: 0 } },
  "settings.update": {
    valid: { autoCleanPersonalNotes: false },
    invalidBecause: "not a boolean",
    invalid: { autoCleanPersonalNotes: "no" },
  },
  "presence.select": {
    valid: { cell: null },
    invalidBecause: "cell is missing",
    invalid: {},
  },
  "sys.ping": { valid: { t0: 1000 }, invalidBecause: "negative time", invalid: { t0: -5 } },
};

const player = {
  id: "p1",
  nickname: "Inés",
  seat: 0,
  joinedAt: 1000,
  connection: "connected",
  role: "active",
  lives: 3,
  score: 0,
  mistakes: 0,
};

const puzzle = {
  id: "c0ffee",
  size: 9,
  boxRows: 3,
  boxCols: 3,
  difficulty: "medium",
  cages: [{ id: 0, cells: [0, 1], sum: 3 }],
  givens: [{ cell: 2, value: 5 }],
};

const ranking = [
  {
    playerId: "p1",
    nickname: "Inés",
    score: 120,
    mistakes: 1,
    scoreReachedAt: 5000,
    position: 1,
  },
];

const snapshot = {
  serverNow: 9000,
  atSeq: 4,
  room: {
    code: "HPQ6NZ",
    state: "running",
    starterId: "p1",
    difficulty: "medium",
    players: [player],
  },
  match: {
    id: "m1",
    puzzle,
    startedAt: 1000,
    endedAt: null,
    result: null,
    hintsLeft: 3,
    locked: [{ cell: 2, value: 5, source: "given", by: null }],
    groupNotes: [{ cell: 0, mask: 3 }],
    ranking: null,
  },
  you: { playerId: "p1", settings: { autoCleanPersonalNotes: true }, personalNotes: [] },
};

export const SERVER_EXAMPLES: Record<ServerMessageType, Example> = {
  "room.welcome": {
    valid: { playerId: "p1", token: "abc", snapshot },
    invalidBecause: "snapshot is missing",
    invalid: { playerId: "p1" },
  },
  "room.player_joined": {
    valid: { player },
    invalidBecause: "unknown connection",
    invalid: { player: { ...player, connection: "away" } },
  },
  "room.player_connection": {
    valid: { playerId: "p2", connection: "left", seat: null },
    invalidBecause: "negative seat",
    invalid: { playerId: "p2", connection: "connected", seat: -1 },
  },
  "room.player_removed": {
    valid: { playerId: "p2" },
    invalidBecause: "empty id",
    invalid: { playerId: "" },
  },
  "room.starter_changed": {
    valid: { playerId: null },
    invalidBecause: "playerId is missing",
    invalid: {},
  },
  "room.difficulty_set": {
    valid: { difficulty: "expert" },
    invalidBecause: "unknown difficulty",
    invalid: { difficulty: "extreme" },
  },
  "room.state_changed": {
    valid: { state: "finished" },
    invalidBecause: "unknown state",
    invalid: { state: "paused" },
  },
  "match.started": {
    valid: { matchId: "m1", puzzle, startedAt: 1000, hintsLeft: 3, players: [player] },
    invalidBecause: "cage of one cell",
    invalid: {
      matchId: "m1",
      puzzle: { ...puzzle, cages: [{ id: 0, cells: [0], sum: 3 }] },
      startedAt: 1000,
      hintsLeft: 3,
      players: [player],
    },
  },
  "cell.solved": {
    valid: {
      cell: 4,
      value: 7,
      by: "p1",
      points: 21,
      score: 21,
      bonuses: [{ unit: "cage", index: 3, points: 1 }],
    },
    invalidBecause: "unknown unit",
    invalid: {
      cell: 4,
      value: 7,
      by: "p1",
      points: 21,
      score: 21,
      bonuses: [{ unit: "diagonal", index: 3, points: 1 }],
    },
  },
  "cell.mistake": {
    valid: { cell: 4, digit: 3, by: "p1", points: -90, score: -90, livesLeft: 2, role: "active" },
    invalidBecause: "unknown role",
    invalid: { cell: 4, digit: 3, by: "p1", points: -90, score: -90, livesLeft: 2, role: "ghost" },
  },
  "cell.already_solved": {
    valid: { cell: 4 },
    invalidBecause: "cell is a string",
    invalid: { cell: "4" },
  },
  "hint.used": {
    valid: { cell: 9, value: 1, by: "p1", points: -60, score: -60, hintsLeft: 2 },
    invalidBecause: "negative hintsLeft",
    invalid: { cell: 9, value: 1, by: "p1", points: -60, score: -60, hintsLeft: -1 },
  },
  "note.applied": {
    valid: { opSeq: 8, layer: "group", op: "remove", cell: 1, digit: 4, by: "p2", undoOf: 5 },
    invalidBecause: "toggle is not an operation",
    invalid: { opSeq: 8, layer: "group", op: "toggle", cell: 1, digit: 4, by: "p2" },
  },
  "presence.updated": {
    valid: { playerId: "p2", cell: 40 },
    invalidBecause: "cell out of range",
    invalid: { playerId: "p2", cell: 9999 },
  },
  "match.ended": {
    valid: { result: "victory", endedAt: 9000, ranking },
    invalidBecause: "unknown result",
    invalid: { result: "draw", endedAt: 9000, ranking },
  },
  ack: { valid: { applied: false }, invalidBecause: "applied missing", invalid: {} },
  error: {
    valid: { code: "undo.not_applicable", reason: "modified" },
    invalidBecause: "unknown code",
    invalid: { code: "teapot" },
  },
  "sys.pong": {
    valid: { t0: 1000, serverNow: 2000 },
    invalidBecause: "serverNow missing",
    invalid: { t0: 1000 },
  },
};
