// Inspector de filtración (SPEC §8.3, T-31.1 y T-29.1): revisa cada mensaje que sale del servidor
// en las pruebas de integración y anota una violación si encuentra:
//   1. una clave `solution`, `tokenHash` o `token` (salvo `token` en el `room.welcome` de su dueño);
//   2. la solución de un puzzle serializada (81 dígitos seguidos o el arreglo JSON);
//   3. un `value` en una celda que no está bloqueada con ese valor en el servidor;
//   4. notas personales de un jugador en un mensaje para otro.
// Además, cada mensaje tiene que cumplir el esquema del protocolo.
import { parseServerEnvelope } from "@sudoku-killer/protocol";

export interface InspectorSources {
  /** Las soluciones de todos los puzzles que el servidor puede elegir. */
  readonly solutions: () => readonly (readonly number[])[];
  /** El valor bloqueado de una celda en el estado vivo de la partida, si lo está. */
  readonly lockedValue: (matchId: string, cell: number) => number | undefined;
}

const FORBIDDEN_KEYS = new Set(["solution", "tokenHash", "token"]);

type Json = null | boolean | number | string | Json[] | JsonObject;
interface JsonObject {
  [key: string]: Json;
}

function isObject(value: Json): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** El valor en la ruta de claves, si todo el camino son objetos. */
function get(value: Json | undefined, ...keys: string[]): Json | undefined {
  let current = value;
  for (const key of keys) {
    if (current === undefined || !isObject(current)) return undefined;
    current = Object.hasOwn(current, key) ? current[key] : undefined;
  }
  return current;
}

export class LeakInspector {
  readonly violations: string[] = [];
  /** Mensajes revisados, para comprobar que el inspector está activo. */
  inspected = 0;
  private readonly sources: InspectorSources;
  /** Jugador de cada cliente (por su `room.welcome`) y su partida actual. */
  private readonly playerOf = new Map<number, string>();
  private readonly matchOf = new Map<number, string>();

  constructor(sources: InspectorSources) {
    this.sources = sources;
  }

  check(clientId: number, text: string): void {
    this.inspected++;
    const fail = (rule: string, detail: string) => {
      this.violations.push(
        `client ${String(clientId)}: ${rule}: ${detail} in ${text.slice(0, 300)}`,
      );
    };
    let message: Json;
    try {
      message = JSON.parse(text) as Json;
    } catch {
      fail("schema", "not JSON");
      return;
    }
    if (!parseServerEnvelope(message).ok) fail("schema", "invalid server envelope");
    if (!isObject(message)) return;
    const type = get(message, "type");
    const payload = get(message, "payload") ?? null;

    // Quién es el destinatario y de qué partida habla el mensaje.
    const welcomePlayer = type === "room.welcome" ? get(payload, "playerId") : undefined;
    if (typeof welcomePlayer === "string") this.playerOf.set(clientId, welcomePlayer);
    const matchId =
      type === "room.welcome"
        ? get(payload, "snapshot", "match", "id")
        : type === "match.started"
          ? get(payload, "matchId")
          : undefined;
    if (typeof matchId === "string") this.matchOf.set(clientId, matchId);
    const recipient = this.playerOf.get(clientId);

    // 1. Claves prohibidas.
    const walk = (value: Json, path: string) => {
      if (Array.isArray(value)) {
        value.forEach((item, i) => {
          walk(item, `${path}[${String(i)}]`);
        });
        return;
      }
      if (!isObject(value)) return;
      for (const [key, item] of Object.entries(value)) {
        const allowed = key === "token" && type === "room.welcome" && path === ".payload";
        if (FORBIDDEN_KEYS.has(key) && !allowed) fail("forbidden key", `${path}.${key}`);
        walk(item, `${path}.${key}`);
      }
    };
    walk(message, "");

    // 2. La solución serializada.
    for (const solution of this.sources.solutions()) {
      if (text.includes(solution.join("")) || text.includes(JSON.stringify(solution))) {
        fail("solution", "serialized solution");
      }
    }

    // 3. `value` solo en celdas bloqueadas con ese valor (convención de §4.3).
    const currentMatch = this.matchOf.get(clientId);
    const values = (value: Json) => {
      if (Array.isArray(value)) {
        for (const item of value) values(item);
        return;
      }
      if (!isObject(value)) return;
      if ("value" in value) {
        const cell = get(value, "cell");
        const digit = get(value, "value");
        if (typeof cell !== "number" || currentMatch === undefined) {
          fail("value", "value without a cell or a match");
        } else if (this.sources.lockedValue(currentMatch, cell) !== digit) {
          fail("value", `cell ${String(cell)} is not locked with ${JSON.stringify(digit)}`);
        }
      }
      for (const item of Object.values(value)) values(item);
    };
    values(payload);

    // 4. Notas personales ajenas.
    if (type === "note.applied" && get(payload, "layer") === "personal") {
      const by = get(payload, "by");
      if (recipient === undefined || by !== recipient) {
        fail("personal notes", `note of ${JSON.stringify(by)} to ${String(recipient)}`);
      }
    }
    if (type === "room.welcome" && get(payload, "snapshot", "you", "playerId") !== recipient) {
      fail("personal notes", "snapshot.you of another player");
    }
  }
}
