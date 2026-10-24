// Fichas de reconexión (SPEC §2.4, T-13.4): 128 bits de un CSPRNG en base64url. El servidor solo
// guarda su SHA-256; la ficha en claro va una sola vez a su dueño, en `room.welcome`, y nunca se
// registra en el log.
import { createHash, randomBytes } from "node:crypto";

export const TOKEN_BYTES = 16;

export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
