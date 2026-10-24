// Mensajes del servidor al cliente (SPEC §4.3) y snapshot (§4.5). Los objetos no son estrictos:
// un campo opcional nuevo es un cambio compatible (§4.7) y el cliente lo descarta al validar.
// Convención anti-filtración: `value` solo lleva dígitos revelados por el servidor; los que aporta
// un jugador viajan como `digit` (§4.3, inspector de §8.3).
import { z } from "zod";
import {
  cellSchema,
  connectionSchema,
  difficultySchema,
  digitSchema,
  lockSourceSchema,
  maskSchema,
  matchResultSchema,
  noteLayerSchema,
  noteOpSchema,
  playerIdSchema,
  protocolVersionSchema,
  roleSchema,
  roomCodeSchema,
  roomStateSchema,
  seqSchema,
  settingsSchema,
  timeSchema,
  tokenSchema,
  unitKindSchema,
} from "./common.ts";
import { errorCodeSchema } from "./errors.ts";
import { publicPuzzleSchema } from "./puzzle.ts";

export const publicPlayerSchema = z.object({
  id: playerIdSchema,
  nickname: z.string(),
  seat: z.int().min(0).nullable(),
  joinedAt: timeSchema,
  connection: connectionSchema,
  role: roleSchema.nullable(),
  lives: z.int().nonnegative(),
  score: z.int(),
  mistakes: z.int().nonnegative(),
});
export type PublicPlayer = z.infer<typeof publicPlayerSchema>;

export const bonusSchema = z.object({
  unit: unitKindSchema,
  index: z.int().nonnegative(),
  points: z.int(),
});
export type Bonus = z.infer<typeof bonusSchema>;

export const rankingEntrySchema = z.object({
  playerId: playerIdSchema,
  nickname: z.string(),
  score: z.int(),
  mistakes: z.int().nonnegative(),
  scoreReachedAt: timeSchema.nullable(),
  position: z.int().positive(),
});
export type RankingEntry = z.infer<typeof rankingEntrySchema>;

const cellMaskSchema = z.object({ cell: cellSchema, mask: maskSchema });

export const lockedCellSchema = z.object({
  cell: cellSchema,
  value: digitSchema,
  source: lockSourceSchema,
  by: playerIdSchema.nullable(),
});
export type LockedCell = z.infer<typeof lockedCellSchema>;

export const snapshotSchema = z.object({
  serverNow: timeSchema,
  atSeq: z.int().nonnegative().nullable(),
  room: z.object({
    code: roomCodeSchema,
    state: roomStateSchema,
    starterId: playerIdSchema.nullable(),
    difficulty: difficultySchema,
    players: z.array(publicPlayerSchema),
  }),
  match: z
    .object({
      id: z.string(),
      puzzle: publicPuzzleSchema,
      startedAt: timeSchema,
      endedAt: timeSchema.nullable(),
      result: matchResultSchema.nullable(),
      hintsLeft: z.int().nonnegative(),
      /** Solo celdas bloqueadas: `value` es un dígito revelado. */
      locked: z.array(lockedCellSchema),
      /** Solo celdas con candidatos. */
      groupNotes: z.array(cellMaskSchema),
      ranking: z.array(rankingEntrySchema).nullable(),
    })
    .nullable(),
  you: z.object({
    playerId: playerIdSchema,
    settings: settingsSchema,
    personalNotes: z.array(cellMaskSchema),
  }),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

/** Payload de cada tipo de mensaje del servidor. */
export const serverPayloadSchemas = {
  "room.welcome": z.object({
    playerId: playerIdSchema,
    token: tokenSchema.optional(),
    snapshot: snapshotSchema,
  }),
  "room.player_joined": z.object({ player: publicPlayerSchema }),
  "room.player_connection": z.object({
    playerId: playerIdSchema,
    connection: connectionSchema,
    seat: z.int().min(0).nullable(),
  }),
  "room.player_removed": z.object({ playerId: playerIdSchema }),
  "room.starter_changed": z.object({ playerId: playerIdSchema.nullable() }),
  "room.difficulty_set": z.object({ difficulty: difficultySchema }),
  "room.state_changed": z.object({ state: roomStateSchema }),
  "match.started": z.object({
    matchId: z.string(),
    puzzle: publicPuzzleSchema,
    startedAt: timeSchema,
    hintsLeft: z.int().nonnegative(),
    players: z.array(publicPlayerSchema),
  }),
  "cell.solved": z.object({
    cell: cellSchema,
    value: digitSchema,
    by: playerIdSchema,
    points: z.int(),
    score: z.int(),
    bonuses: z.array(bonusSchema),
  }),
  "cell.mistake": z.object({
    cell: cellSchema,
    digit: digitSchema,
    by: playerIdSchema,
    points: z.int(),
    score: z.int(),
    livesLeft: z.int().nonnegative(),
    role: roleSchema,
  }),
  "cell.already_solved": z.object({ cell: cellSchema }),
  "hint.used": z.object({
    cell: cellSchema,
    value: digitSchema,
    by: playerIdSchema,
    points: z.int(),
    score: z.int(),
    hintsLeft: z.int().nonnegative(),
  }),
  "note.applied": z.object({
    opSeq: seqSchema,
    layer: noteLayerSchema,
    op: noteOpSchema,
    cell: cellSchema,
    digit: digitSchema,
    by: playerIdSchema,
    undoOf: seqSchema.optional(),
  }),
  "presence.updated": z.object({ playerId: playerIdSchema, cell: cellSchema.nullable() }),
  "match.ended": z.object({
    result: matchResultSchema,
    endedAt: timeSchema,
    ranking: z.array(rankingEntrySchema),
  }),
  ack: z.object({ applied: z.boolean() }),
  error: z.object({ code: errorCodeSchema, reason: z.string().max(64).optional() }),
  "sys.pong": z.object({ t0: timeSchema, serverNow: timeSchema }),
} as const;

type ServerPayloadSchemas = typeof serverPayloadSchemas;
export type ServerMessageType = keyof ServerPayloadSchemas;
export type ServerPayload<T extends ServerMessageType> = z.infer<ServerPayloadSchemas[T]>;

export const SERVER_MESSAGE_TYPES = Object.keys(serverPayloadSchemas) as ServerMessageType[];

function envelopeOf<T extends ServerMessageType>(type: T) {
  return z.object({
    v: protocolVersionSchema,
    type: z.literal(type),
    seq: seqSchema.optional(),
    replyTo: z.string().min(1).max(64).optional(),
    payload: serverPayloadSchemas[type],
  });
}

export const serverEnvelopeSchema = z.discriminatedUnion("type", [
  envelopeOf("room.welcome"),
  envelopeOf("room.player_joined"),
  envelopeOf("room.player_connection"),
  envelopeOf("room.player_removed"),
  envelopeOf("room.starter_changed"),
  envelopeOf("room.difficulty_set"),
  envelopeOf("room.state_changed"),
  envelopeOf("match.started"),
  envelopeOf("cell.solved"),
  envelopeOf("cell.mistake"),
  envelopeOf("cell.already_solved"),
  envelopeOf("hint.used"),
  envelopeOf("note.applied"),
  envelopeOf("presence.updated"),
  envelopeOf("match.ended"),
  envelopeOf("ack"),
  envelopeOf("error"),
  envelopeOf("sys.pong"),
]);

export type ServerEnvelope = z.infer<typeof serverEnvelopeSchema>;
/** Un mensaje del servidor con su tipo: `ServerMessage<"cell.solved">`. */
export type ServerMessage<T extends ServerMessageType = ServerMessageType> = Extract<
  ServerEnvelope,
  { type: T }
>;

export type ServerParseResult =
  | { readonly ok: true; readonly message: ServerEnvelope }
  /** `unknown_type`: el cliente lo ignora y lo registra (§4.7). */
  | { readonly ok: false; readonly reason: "unknown_type" | "invalid"; readonly type?: string };

const typeProbeSchema = z.object({ v: protocolVersionSchema, type: z.string() });

/** Valida un mensaje del servidor ya decodificado de JSON (lo usa el cliente). */
export function parseServerEnvelope(input: unknown): ServerParseResult {
  const probe = typeProbeSchema.safeParse(input);
  if (!probe.success) return { ok: false, reason: "invalid" };
  const { type } = probe.data;
  if (!(SERVER_MESSAGE_TYPES as readonly string[]).includes(type)) {
    return { ok: false, reason: "unknown_type", type };
  }
  const parsed = serverEnvelopeSchema.safeParse(input);
  return parsed.success
    ? { ok: true, message: parsed.data }
    : { ok: false, reason: "invalid", type };
}
