// Esquema Zod de los eventos del registro (ADR 0004): el servidor valida cada evento que lee de la
// base de datos antes de reproducirlo. Tiene que coincidir con `events.ts`: lo comprueban el tipo de
// `matchEventSchema` y una prueba con un ejemplo válido y uno inválido por tipo.
import {
  cellSchema,
  clientMsgIdSchema,
  connectionSchema,
  difficultySchema,
  digitSchema,
  matchResultSchema,
  nicknameSchema,
  noteLayerSchema,
  noteOpSchema,
  playerIdSchema,
  seqSchema,
  timeSchema,
} from "@sudoku-killer/protocol";
import { z } from "zod";
import type { MatchEvent, MatchEventType } from "./events.ts";

const seatSchema = z.int().min(0).max(15).nullable();

export const playerEntrySchema = z.strictObject({
  playerId: playerIdSchema,
  nickname: nicknameSchema,
  seat: seatSchema,
  joinedAt: timeSchema,
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  connection: connectionSchema,
  autoCleanPersonalNotes: z.boolean(),
});

/** Payload de cada tipo de evento. */
export const eventPayloadSchemas = {
  "match.started": z.strictObject({
    matchId: z.string().min(1),
    puzzleId: z.string().min(1),
    difficulty: difficultySchema,
    modeId: z.string().min(1),
    scoringParamsVersion: z.string().min(1),
    hintsTotal: z.int().nonnegative(),
    starterId: playerIdSchema.nullable(),
    players: z.array(playerEntrySchema),
  }),
  "player.joined": playerEntrySchema,
  "player.connection": z.strictObject({
    playerId: playerIdSchema,
    connection: connectionSchema,
    seat: seatSchema,
  }),
  "starter.changed": z.strictObject({ playerId: playerIdSchema.nullable() }),
  "settings.changed": z.strictObject({
    playerId: playerIdSchema,
    autoCleanPersonalNotes: z.boolean(),
    clientMsgId: clientMsgIdSchema,
  }),
  "cell.solved": z.strictObject({
    playerId: playerIdSchema,
    cell: cellSchema,
    value: digitSchema,
    level: z.int().min(1).max(5),
    graderVersion: z.string().min(1),
    clientMsgId: clientMsgIdSchema,
  }),
  "cell.mistake": z.strictObject({
    playerId: playerIdSchema,
    cell: cellSchema,
    digit: digitSchema,
    clientMsgId: clientMsgIdSchema,
  }),
  "hint.used": z.strictObject({
    playerId: playerIdSchema,
    cell: cellSchema,
    value: digitSchema,
    clientMsgId: clientMsgIdSchema,
  }),
  "note.op": z.strictObject({
    layer: noteLayerSchema,
    ownerId: playerIdSchema.nullable(),
    playerId: playerIdSchema,
    cell: cellSchema,
    digit: digitSchema,
    op: noteOpSchema,
    clientMsgId: clientMsgIdSchema,
    undoOf: seqSchema.exactOptional(),
  }),
  "match.ended": z.strictObject({ result: matchResultSchema }),
} as const satisfies Record<MatchEventType, z.ZodType>;

export const MATCH_EVENT_TYPES = Object.keys(eventPayloadSchemas) as MatchEventType[];

function eventOf<T extends MatchEventType>(type: T) {
  return z.strictObject({
    seq: seqSchema,
    ts: timeSchema,
    type: z.literal(type),
    payload: eventPayloadSchemas[type],
  });
}

const eventSchema = z.discriminatedUnion("type", [
  eventOf("match.started"),
  eventOf("player.joined"),
  eventOf("player.connection"),
  eventOf("starter.changed"),
  eventOf("settings.changed"),
  eventOf("cell.solved"),
  eventOf("cell.mistake"),
  eventOf("hint.used"),
  eventOf("note.op"),
  eventOf("match.ended"),
]);

/** Un evento del registro: lo que valida es un `MatchEvent` (si `events.ts` cambia y este esquema
 * no, deja de compilar). */
export const matchEventSchema: z.ZodType<MatchEvent> = eventSchema;
