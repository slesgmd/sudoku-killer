// Tipos básicos del protocolo v1 (SPEC §2 y §4). Las cotas son de forma: el servidor comprueba
// contra el tablero y la sala si una celda, un dígito o un apodo valen.
import { z } from "zod";

/** Versión del protocolo que acepta el servidor de la v1 (SPEC §4.7). */
export const PROTOCOL_VERSION = 1;

export const protocolVersionSchema = z.literal(PROTOCOL_VERSION);

/** Tableros de hasta 16 × 16 (R-35): 256 celdas y dígitos de 1 a 16. */
export const MAX_CELLS = 256;
export const MAX_DIGIT = 16;

export const cellSchema = z
  .int()
  .min(0)
  .max(MAX_CELLS - 1);
export const digitSchema = z.int().min(1).max(MAX_DIGIT);
/** Máscara de candidatos: el bit `d − 1` es el dígito `d` (SPEC §2.1). */
export const maskSchema = z
  .int()
  .min(0)
  .max(2 ** MAX_DIGIT - 1);
/** Hora del servidor o del cliente, en milisegundos. */
export const timeSchema = z.int().nonnegative();
export const seqSchema = z.int().positive();
export const playerIdSchema = z.string().min(1).max(64);
/** Apodo tal como llega; su validez (2 a 16 caracteres, D2) la decide el servidor. */
export const nicknameSchema = z.string().max(64);
export const roomCodeSchema = z.string().max(16);
export const tokenSchema = z.string().min(1).max(64);

/** Dificultades del juego, de la más fácil a la más difícil (SPEC §2.2). */
export const DIFFICULTIES = ["easy", "medium", "hard", "expert"] as const;
export const difficultySchema = z.enum(DIFFICULTIES);
export type Difficulty = z.infer<typeof difficultySchema>;

/**
 * Números iniciales de cada dificultad, según la equivalencia versión 2 (`docs/dificultad.md`).
 * Única fuente: `packages/bank` arma con ella sus reglas y el Lobby la muestra. Va en el protocolo
 * porque el cliente de producción no puede importar el banco (T-31.2) y no revela nada de la solución.
 */
export const DIFFICULTY_GIVENS: Readonly<Record<Difficulty, number>> = {
  easy: 30,
  medium: 22,
  hard: 10,
  expert: 0,
};

export const ROOM_STATES = ["waiting", "running", "finished"] as const;
export const roomStateSchema = z.enum(ROOM_STATES);
export type RoomState = z.infer<typeof roomStateSchema>;

export const ROLES = ["active", "spectator"] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const CONNECTIONS = ["connected", "disconnected", "expired", "left"] as const;
export const connectionSchema = z.enum(CONNECTIONS);
export type Connection = z.infer<typeof connectionSchema>;

export const NOTE_LAYERS = ["personal", "group"] as const;
export const noteLayerSchema = z.enum(NOTE_LAYERS);
export type NoteLayer = z.infer<typeof noteLayerSchema>;

export const NOTE_OPS = ["add", "remove"] as const;
export const noteOpSchema = z.enum(NOTE_OPS);
export type NoteOp = z.infer<typeof noteOpSchema>;

export const MATCH_RESULTS = ["victory", "defeat"] as const;
export const matchResultSchema = z.enum(MATCH_RESULTS);
export type MatchResult = z.infer<typeof matchResultSchema>;

/**
 * Causa de una derrota (SPEC §4.3), según cómo terminaron los jugadores del ranking:
 * `lives` si todos quedaron con 0 vidas, `gone` si ninguno (salieron o expiraron) y `mixed` si hay
 * de los dos. Se deriva del estado final: el registro de eventos no la guarda.
 */
export const DEFEAT_CAUSES = ["lives", "gone", "mixed"] as const;
export const defeatCauseSchema = z.enum(DEFEAT_CAUSES);
export type DefeatCause = z.infer<typeof defeatCauseSchema>;

export const UNIT_KINDS = ["row", "col", "box", "cage"] as const;
export const unitKindSchema = z.enum(UNIT_KINDS);

export const LOCK_SOURCES = ["given", "solved", "hint"] as const;
export const lockSourceSchema = z.enum(LOCK_SOURCES);
export type LockSource = z.infer<typeof lockSourceSchema>;

export const settingsSchema = z.object({ autoCleanPersonalNotes: z.boolean() });
export type Settings = z.infer<typeof settingsSchema>;
