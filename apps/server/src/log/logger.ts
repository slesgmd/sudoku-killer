// Log del servidor: una línea JSON por entrada. Nunca registra fichas, sus hash, la clave de acceso
// del grupo ni su hash (F12) ni la cadena de conexión a la base de datos: esas claves, y cualquier
// texto con forma de URL de PostgreSQL o de hash `sha256:…`, se reemplazan por "[redacted]" aunque
// lleguen por error.
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

const REDACTED_KEYS = new Set([
  "token",
  "tokenhash",
  "token_hash",
  "password",
  "databaseurl",
  "database_url",
  "accesskey",
  "access_key",
  "accesskeyhash",
  "access_key_hash",
]);
const POSTGRES_URL = /postgres(?:ql)?:\/\/\S+/gi;
const SHA256_HASH = /sha256:[0-9a-f]{64}/gi;
const MAX_DEPTH = 6;

export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string")
    return value.replace(POSTGRES_URL, "[redacted]").replace(SHA256_HASH, "[redacted]");
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return value;
  if (value instanceof Error) {
    // Solo el nombre y el mensaje: la traza se queda en el servidor, pero sin datos sensibles.
    return {
      name: value.name,
      message: redact(value.message, depth + 1),
      stack: redact(value.stack, depth + 1),
    };
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? "[redacted]" : redact(item, depth + 1);
  }
  return out;
}

export function createLogger({
  level = "info",
  write = (line: string) => {
    process.stdout.write(`${line}\n`);
  },
  now = () => Date.now(),
}: {
  readonly level?: LogLevel;
  readonly write?: (line: string) => void;
  readonly now?: () => number;
} = {}): Logger {
  const log =
    (at: LogLevel) =>
    (message: string, fields: LogFields = {}) => {
      if (LEVELS[at] < LEVELS[level]) return;
      const entry = {
        time: new Date(now()).toISOString(),
        level: at,
        message,
        ...(redact(fields) as object),
      };
      write(JSON.stringify(entry));
    };
  return { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") };
}

/** Un log que no escribe nada. */
export const silentLogger: Logger = createLogger({ write: () => undefined });
