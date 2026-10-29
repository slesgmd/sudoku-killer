// Límites y plazos del servidor (SPEC §3, §4.6 y §4.8; ADR 0002). La prueba de carga los confirmó
// (`docs/carga.md`).
import { NORMAL_RULES } from "@sudoku-killer/game";
import type { BucketSpec } from "./token-bucket.ts";

/** Plazo de gracia de una desconexión y de una sala sin nadie conectado (R-13, R-14). */
export const GRACE_MS = NORMAL_RULES.graceMs;
/** Una conexión que no entra a ninguna sala se cierra a los 30 s (ADR 0002). */
export const NO_ROOM_MS = 30_000;
/** Como máximo una difusión de presencia cada 100 ms por jugador (§4.8). */
export const PRESENCE_WINDOW_MS = 100;
/** `clientMsgId` recordados por jugador (§4.6). */
export const IDEMPOTENCY_ENTRIES = 256;

/**
 * Tope de salas a la vez en una instancia (`docs/seguridad.md` S-01): sin él, conexiones sin
 * autenticar podían crear salas sin límite. Diez veces las 50 de la prueba de carga; `room.create`
 * por encima recibe `server.unavailable`.
 */
export const MAX_ROOMS = 500;

/** Comandos: 20 por segundo con ráfagas de 40. */
export const COMMAND_BUCKET: BucketSpec = { rate: 20, burst: 40 };
/** Presencia: lo que sobra se descarta sin aviso. */
export const PRESENCE_BUCKET: BucketSpec = { rate: 50, burst: 50 };
/** `sys.ping` del cliente (uno cada 5 s): lo que sobra se descarta sin aviso. */
export const PING_BUCKET: BucketSpec = { rate: 2, burst: 5 };

/** Saturación (E-17): por encima, se descarta la presencia; por encima del segundo, se cierra. */
export const DROP_PRESENCE_BYTES = 256 * 1024;
export const CLOSE_SLOW_BYTES = 1024 * 1024;

/** Códigos de cierre estándar de WebSocket (RFC 6455) que usa el servidor. */
export const CLOSE_GOING_AWAY = 1001;
export const CLOSE_TOO_BIG = 1009;
export const CLOSE_SERVICE_RESTART = 1012;
export const CLOSE_TRY_AGAIN_LATER = 1013;
