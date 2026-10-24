// Códigos de error (SPEC §4.4). Un error nunca cambia vidas ni puntos.
import { z } from "zod";

export const ERROR_CODES = [
  "bad_request",
  "protocol.unsupported",
  "rate_limited",
  "room.not_found",
  "room.full",
  "room.wrong_state",
  "nickname.invalid",
  "nickname.taken",
  "forbidden",
  "match.not_running",
  "cell.locked",
  "hint.none_left",
  "undo.not_applicable",
  "server.unavailable",
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Motivos de `undo.not_applicable` (P7, ADR 0005). */
export const UNDO_REASONS = ["modified", "not_owner", "unknown_op"] as const;
export type UndoReason = (typeof UNDO_REASONS)[number];

/** Código con que se cierra la conexión tras `protocol.unsupported` (SPEC §4.4). */
export const CLOSE_UNSUPPORTED = 4000;
/** La misma ficha se abrió en otra pestaña (E-08). */
export const CLOSE_REPLACED = 4001;
