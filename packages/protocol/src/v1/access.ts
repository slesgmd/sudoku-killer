// Clave de acceso del grupo (`docs/seguridad.md` S-02, SPEC R-39). El cliente la comprueba antes
// con `POST /access`, en la cabecera `X-Sk-Access-Key` (T-39.12), y después la ofrece en el handshake,
// como subprotocolo del WebSocket: `sk.v1` y `sk.k.<clave en base64url>`. En los dos casos va en
// base64url y nunca en una URL ni en un mensaje, así que no queda en los logs de acceso de un proxy.
// Una clave que no vale recibe 401 en `POST /access` y cierra la conexión con 4003.

/** El subprotocolo que el servidor elige siempre que se ofrece. */
export const ACCESS_PROTOCOL = "sk.v1";
/** El prefijo del subprotocolo que lleva la clave. */
export const KEY_PROTOCOL_PREFIX = "sk.k.";
/** La ruta HTTP que comprueba una clave (T-39.12): 204, 401 o 429. */
export const ACCESS_PATH = "/access";
/** La cabecera de `POST /access` que lleva la clave, en base64url. */
export const ACCESS_KEY_HEADER = "x-sk-access-key";
export const ACCESS_KEY_MIN_LENGTH = 12;
export const ACCESS_KEY_MAX_LENGTH = 64;

// Globales del navegador y de Node que el paquete usa sin depender de los tipos de uno ni del otro
// (el build de `packages/protocol` solo tiene ES2024).
declare function btoa(data: string): string;
declare function atob(data: string): string;
declare const TextEncoder: new () => { encode(input: string): Uint8Array };
declare const TextDecoder: new (
  label: string,
  options: { fatal: boolean },
) => { decode(input: Uint8Array): string };

/** La forma comparable de una clave: NFKC, mayúsculas, sin espacios ni guiones. */
export function normalizeAccessKey(raw: string): string {
  return raw
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s-]+/gu, "");
}

/** Si una clave (ya normalizada) tiene un largo aceptable. */
export function isValidAccessKey(key: string): boolean {
  return key.length >= ACCESS_KEY_MIN_LENGTH && key.length <= ACCESS_KEY_MAX_LENGTH;
}

function toBase64Url(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** La clave normalizada en base64url (la cabecera de `POST /access`), o `null` si queda vacía. */
export function encodeAccessKey(key: string): string | null {
  const normalized = normalizeAccessKey(key);
  return normalized === "" ? null : toBase64Url(normalized);
}

/** La clave de un valor en base64url, normalizada, o `null` si no es una clave válida. */
export function decodeAccessKey(encoded: string): string | null {
  const decoded = fromBase64Url(encoded);
  if (decoded === null) return null;
  const key = normalizeAccessKey(decoded);
  return isValidAccessKey(key) ? key : null;
}

/** Los subprotocolos que ofrece el cliente: `sk.v1` y, con clave, la clave normalizada. */
export function accessProtocols(key: string | null): string[] {
  const encoded = key === null ? null : encodeAccessKey(key);
  return encoded === null
    ? [ACCESS_PROTOCOL]
    : [ACCESS_PROTOCOL, `${KEY_PROTOCOL_PREFIX}${encoded}`];
}

/** La clave que ofreció un cliente, normalizada, o `null` si no ofreció ninguna válida. */
export function keyFromProtocols(protocols: Iterable<string>): string | null {
  for (const protocol of protocols) {
    if (protocol.startsWith(KEY_PROTOCOL_PREFIX))
      return decodeAccessKey(protocol.slice(KEY_PROTOCOL_PREFIX.length));
  }
  return null;
}
