// Hash del puzzle en el navegador: el mismo que calcula el servidor con `node:crypto` para el
// manifiesto (primeros 16 dígitos hexadecimales del SHA-256 de `canonicalPuzzle`). Usa
// `crypto.subtle` si está; fuera de un contexto seguro (red local por `http://<IP>`) no existe y se
// usa el SHA-256 en JavaScript de `sha256.ts`. Las pruebas comprueban que los tres coinciden.
import { sha256Hex } from "./sha256.ts";

const HASH_LENGTH = 16;

export async function puzzleHashSubtle(canonical: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, HASH_LENGTH);
}

export function puzzleHashJs(canonical: string): string {
  return sha256Hex(new TextEncoder().encode(canonical)).slice(0, HASH_LENGTH);
}

/** `crypto.subtle` si el navegador lo expone; si no, el SHA-256 en JavaScript. */
export async function puzzleHash(canonical: string): Promise<string> {
  const subtle = (globalThis.crypto as Partial<Crypto> | undefined)?.subtle;
  return subtle ? puzzleHashSubtle(canonical) : puzzleHashJs(canonical);
}
