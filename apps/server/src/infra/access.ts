// Clave de acceso del grupo en el servidor (`docs/seguridad.md` S-02, SPEC R-39). El servidor
// guarda solo el hash (`ACCESS_KEY_HASH`, SHA-256 con un prefijo de dominio) y compara en tiempo
// constante. Tras `MAX_ACCESS_FAILURES` claves que no valen desde una IP en `ACCESS_FAILURE_WINDOW_MS`,
// esa IP recibe 429 en el handshake y en `POST /access` hasta que pase la ventana. Los dos caminos
// comparten los fallos, la espera y las métricas (T-39.12).
// - Solo cuenta una clave ofrecida que no vale: un navegador que todavía no tiene clave no la está
//   adivinando, recibe 401 o 4003 siempre y nunca queda bloqueado (T-39.7).
// - Sin dirección conocida (`null`, T-39.8), los fallos no se cuentan: si se contaran juntos, unos
//   pocos bloquearían a todos.
import { createHash, timingSafeEqual } from "node:crypto";
import {
  KEY_PROTOCOL_PREFIX,
  decodeAccessKey,
  keyFromProtocols,
  normalizeAccessKey,
} from "@sudoku-killer/protocol";
import type { Clock } from "./clock.ts";

export const MAX_ACCESS_FAILURES = 10;
export const ACCESS_FAILURE_WINDOW_MS = 10 * 60_000;
/** Tope de IP con fallos recordadas a la vez (memoria acotada). */
export const MAX_TRACKED_IPS = 10_000;

const DOMAIN = "sudoku-killer/access/v1:";

/** El valor de `ACCESS_KEY_HASH` para una clave: `sha256:` y 64 dígitos hexadecimales. */
export function hashAccessKey(key: string): string {
  const digest = createHash("sha256")
    .update(DOMAIN + normalizeAccessKey(key), "utf8")
    .digest("hex");
  return `sha256:${digest}`;
}

export type AccessResult = "admitted" | "missing" | "denied";

export interface AccessGateOptions {
  /** El hash de la clave, o `null` para no pedirla (desarrollo y pruebas). */
  readonly hash: string | null;
  readonly clock: Clock;
  readonly maxFailures?: number;
  readonly windowMs?: number;
}

export class AccessGate {
  /** Se puede cambiar en caliente (las E2E piden la clave solo en sus pruebas). */
  hash: string | null;
  private readonly clock: Clock;
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly failures = new Map<string, { count: number; resetAt: number }>();
  /** Claves ofrecidas que no valen desde que arrancó (métricas). */
  denied = 0;
  /** Conexiones sin clave desde que arrancó (métricas): un navegador nuevo, no un intento. */
  missing = 0;

  constructor({
    hash,
    clock,
    maxFailures = MAX_ACCESS_FAILURES,
    windowMs = ACCESS_FAILURE_WINDOW_MS,
  }: AccessGateOptions) {
    this.hash = hash;
    this.clock = clock;
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
  }

  get required(): boolean {
    return this.hash !== null;
  }

  /** Cuánto falta (en ms) para que la IP pueda volver a probar claves, o 0 si no está bloqueada. */
  lockedFor(ip: string | null): number {
    if (ip === null) return 0;
    const entry = this.failures.get(ip);
    if (!entry) return 0;
    const left = entry.resetAt - this.clock.now();
    if (left <= 0) {
      this.failures.delete(ip);
      return 0;
    }
    return entry.count >= this.maxFailures ? left : 0;
  }

  /**
   * Si los subprotocolos ofrecidos traen la clave (`admitted`), no traen ninguna (`missing`) o traen
   * otra o una mal formada (`denied`, que cuenta un fallo para la IP).
   */
  admit(protocols: readonly string[], ip: string | null): AccessResult {
    return this.verify(offersKey(protocols), () => keyFromProtocols(protocols), ip);
  }

  /** Lo mismo para la cabecera de `POST /access` (T-39.12): ausente o vacía es `missing`. */
  check(header: string | undefined, ip: string | null): AccessResult {
    const offered = header !== undefined && header.trim() !== "";
    return this.verify(
      offered,
      () => (header === undefined ? null : decodeAccessKey(header.trim())),
      ip,
    );
  }

  private verify(offered: boolean, key: () => string | null, ip: string | null): AccessResult {
    if (this.hash === null) return "admitted";
    if (!offered) {
      this.missing++;
      return "missing";
    }
    const found = key();
    if (found !== null && sameHash(hashAccessKey(found), this.hash)) return "admitted";
    this.denied++;
    if (ip !== null) this.fail(ip);
    return "denied";
  }

  private fail(ip: string): void {
    const now = this.clock.now();
    const entry = this.failures.get(ip);
    if (entry && now < entry.resetAt) {
      entry.count++;
      return;
    }
    if (this.failures.size >= MAX_TRACKED_IPS) this.prune(now);
    this.failures.set(ip, { count: 1, resetAt: now + this.windowMs });
  }

  private prune(now: number): void {
    for (const [ip, entry] of this.failures) if (now >= entry.resetAt) this.failures.delete(ip);
    if (this.failures.size >= MAX_TRACKED_IPS) this.failures.clear();
  }
}

/** Si el cliente ofreció alguna clave (válida o no): solo esas ofertas cuentan como intentos. */
export function offersKey(protocols: readonly string[]): boolean {
  return protocols.some((protocol) => protocol.startsWith(KEY_PROTOCOL_PREFIX));
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
