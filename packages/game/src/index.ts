// Reductor puro de la partida y módulos GameMode (ADR 0004, SPEC §5). Sin E/S, reloj ni azar: el
// tiempo llega en `event.ts` y en el contexto. El cliente usa `@sudoku-killer/game/client`, que no
// incluye `decide` ni el calificador.
export type {
  CellState,
  Exclusion,
  MatchPlayer,
  MatchState,
  NoteRecord,
  PlayerId,
} from "./types.ts";
export type {
  EventOfType,
  MatchEvent,
  MatchEventType,
  MatchStartedEvent,
  PlayerEntry,
} from "./events.ts";
export type { GameMode, MistakeContext, PlacementContext } from "./mode.ts";
export { NORMAL_RULES, normalCan, type Action, type ModeRules } from "./permissions.ts";
export { NORMAL_MODE_ID, createNormalMode } from "./modes/normal.ts";
export { cellCountOf, closedUnitsOf, noteKey, valuesOf } from "./board.ts";
export {
  apply,
  applyWithEffects,
  initialState,
  replay,
  type Effects,
  type ReducerContext,
} from "./apply.ts";
export { startMatch, type StartOptions } from "./start.ts";
export {
  GAME_COMMAND_TYPES,
  decide,
  decideConnection,
  decideJoin,
  decideStarter,
  type DecideContext,
  type Decision,
  type GameCommand,
  type GameCommandType,
  type Reply,
} from "./decide.ts";
export {
  fanOut,
  messagesOf,
  publicPlayer,
  publicPlayers,
  snapshotFor,
  type Audience,
  type Outgoing,
  type RoomView,
} from "./project.ts";
export {
  freeSeat,
  generateRoomCode,
  holdsSeat,
  lobbyPlayer,
  lobbySnapshot,
  nextStarter,
  seatFor,
  type RoomMember,
} from "./room.ts";
export {
  MATCH_EVENT_TYPES,
  eventPayloadSchemas,
  matchEventSchema,
  playerEntrySchema,
} from "./event-schema.ts";
