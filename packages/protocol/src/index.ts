// Mensajes y esquemas del protocolo (SPEC §4). Nada de lo que se exporta aquí puede llevar
// la solución (T-31.3).
import { z } from "zod";

/** Versión del protocolo que acepta el servidor de la v1 (SPEC §4.7). */
export const PROTOCOL_VERSION = 1;

export const protocolVersionSchema = z.literal(PROTOCOL_VERSION);
