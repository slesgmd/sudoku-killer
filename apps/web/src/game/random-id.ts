// Identificadores al azar con `crypto.getRandomValues`, que existe también fuera de un contexto
// seguro. `crypto.randomUUID` y `crypto.subtle` no: por `http://<IP>` de la red local el navegador
// no los expone, y la partida se quedaba en «Entrando…» (prueba en el celular).
const HEX = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, "0"));

/** Un UUID versión 4 (RFC 9562), como el de `crypto.randomUUID`. */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => HEX[byte] ?? "00").join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
