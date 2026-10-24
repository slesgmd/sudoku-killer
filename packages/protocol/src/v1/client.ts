// Mensajes del cliente al servidor (SPEC §4.2). Los payloads son estrictos: un campo de más es
// `bad_request`. No existen mensajes para expulsar, cerrar la sala, pausar, borrar un número,
// deshacer una jugada, alternar candidatos ni pedir una segunda oportunidad (R-10, R-16, R-25, R-34).
import { z } from "zod";
import {
  cellSchema,
  difficultySchema,
  digitSchema,
  nicknameSchema,
  noteLayerSchema,
  protocolVersionSchema,
  roomCodeSchema,
  seqSchema,
  timeSchema,
  tokenSchema,
} from "./common.ts";

const empty = z.strictObject({});

/** Payload de cada tipo de mensaje del cliente. */
export const clientPayloadSchemas = {
  "room.create": z.strictObject({ nickname: nicknameSchema }),
  "room.join": z.strictObject({
    code: roomCodeSchema,
    nickname: nicknameSchema,
    token: tokenSchema.optional(),
  }),
  "room.leave": empty,
  "room.set_difficulty": z.strictObject({ difficulty: difficultySchema }),
  "room.reset": empty,
  "match.start": empty,
  "cell.place": z.strictObject({ cell: cellSchema, digit: digitSchema }),
  "hint.use": z.strictObject({ cell: cellSchema }),
  "note.add": z.strictObject({ layer: noteLayerSchema, cell: cellSchema, digit: digitSchema }),
  "note.remove": z.strictObject({ layer: noteLayerSchema, cell: cellSchema, digit: digitSchema }),
  "note.undo": z.strictObject({ opSeq: seqSchema }),
  "settings.update": z.strictObject({ autoCleanPersonalNotes: z.boolean() }),
  "presence.select": z.strictObject({ cell: cellSchema.nullable() }),
  "sys.ping": z.strictObject({ t0: timeSchema }),
} as const;

type ClientPayloadSchemas = typeof clientPayloadSchemas;
export type ClientMessageType = keyof ClientPayloadSchemas;
export type ClientPayload<T extends ClientMessageType> = z.infer<ClientPayloadSchemas[T]>;

export const CLIENT_MESSAGE_TYPES = Object.keys(clientPayloadSchemas) as ClientMessageType[];

/** `clientMsgId`: de 1 a 64 caracteres, único por jugador (SPEC §4.1). */
export const clientMsgIdSchema = z.string().min(1).max(64);

function envelopeOf<T extends ClientMessageType>(type: T) {
  return z.strictObject({
    v: protocolVersionSchema,
    id: clientMsgIdSchema,
    type: z.literal(type),
    payload: clientPayloadSchemas[type],
  });
}

export const clientEnvelopeSchema = z.discriminatedUnion("type", [
  envelopeOf("room.create"),
  envelopeOf("room.join"),
  envelopeOf("room.leave"),
  envelopeOf("room.set_difficulty"),
  envelopeOf("room.reset"),
  envelopeOf("match.start"),
  envelopeOf("cell.place"),
  envelopeOf("hint.use"),
  envelopeOf("note.add"),
  envelopeOf("note.remove"),
  envelopeOf("note.undo"),
  envelopeOf("settings.update"),
  envelopeOf("presence.select"),
  envelopeOf("sys.ping"),
]);

export type ClientEnvelope = z.infer<typeof clientEnvelopeSchema>;
/** Un mensaje del cliente con su tipo: `ClientMessage<"cell.place">`. */
export type ClientMessage<T extends ClientMessageType = ClientMessageType> = Extract<
  ClientEnvelope,
  { type: T }
>;

/** Lo mínimo para saber la versión antes de validar el resto. */
const versionProbeSchema = z.object({ v: z.unknown() });

export type ClientParseResult =
  | { readonly ok: true; readonly message: ClientEnvelope }
  | { readonly ok: false; readonly code: "bad_request" | "protocol.unsupported" };

/**
 * Valida un mensaje entrante ya decodificado de JSON. Una versión distinta de 1 da
 * `protocol.unsupported` (E-19); cualquier otro fallo, incluido un tipo inexistente, `bad_request`
 * (E-18).
 */
export function parseClientEnvelope(input: unknown): ClientParseResult {
  const probe = versionProbeSchema.safeParse(input);
  if (probe.success && probe.data.v !== undefined && probe.data.v !== 1) {
    return { ok: false, code: "protocol.unsupported" };
  }
  const parsed = clientEnvelopeSchema.safeParse(input);
  return parsed.success ? { ok: true, message: parsed.data } : { ok: false, code: "bad_request" };
}
