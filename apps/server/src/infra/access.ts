// Clave de acceso del grupo en el servidor (F12, `docs/seguridad.md` S-02, SPEC R-39). El servidor
// guarda solo el hash (`ACCESS_KEY_HASH`, SHA-256 con un prefijo de dominio) y compara en tiempo
// constante. Tras `MAX_ACCESS_FAILURES` claves que no valen desde una IP en `ACCESS_FAILURE_WINDOW_MS`,
// esa IP recibe 429 en el handshake hasta que pase la ventana.
import { createHash, timingSafeEqual } from "node:crypto";
import { keyFromProtocols, normalizeAccessKey } from "@sudoku-killer/protocol";
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

  /** Si la IP agotó sus intentos en la ventana actual. */
  locked(ip: string): boolean {
    const entry = this.failures.get(ip);
    if (!entry) return false;
    if (this.clock.now() >= entry.resetAt) {
      this.failures.delete(ip);
      return false;
    }
    return entry.count >= this.maxFailures;
  }

  /** Si los subprotocolos ofrecidos traen la clave; si no, cuenta un fallo para la IP. */
  admit(protocols: Iterable<string>, ip: string): boolean {
    if (this.hash === null) return true;
    const key = keyFromProtocols(protocols);
    if (key !== null && sameHash(hashAccessKey(key), this.hash)) return true;
    this.fail(ip);
    return false;
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

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
