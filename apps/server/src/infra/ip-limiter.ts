// Límites por IP (SPEC R-40 y §4.8): frenan ráfagas y excesos sin molestar a personas reales. Cada
// límite tiene una o más ventanas fijas, «más de `max` en `windowMs`», cada una con su espera. La
// espera siempre es temporal. Todo vive en memoria: un arranque lo olvida.
// - Una IP desconocida (`null`) nunca cuenta ni espera: si contara, unos pocos bloquearían a todos
//   los que comparten esa falta de dato (T-39.7, T-39.8).
// - IPv6 se agrupa por su prefijo /64, que es lo que suele tener un solo hogar: dentro de él, un
//   equipo puede cambiar de dirección cuando quiera.
// - La memoria está acotada: como máximo `MAX_TRACKED_KEYS` direcciones por limitador.
import type { Clock } from "./clock.ts";

export interface LimitWindow {
  /** Se pasa el límite con más de `max` en la ventana. */
  readonly max: number;
  readonly windowMs: number;
  /** Cuánto se espera; sin él, hasta que termine la ventana. */
  readonly waitMs?: number;
}

/** Las ventanas de un límite, de la más corta a la más larga. */
export type LimitSpec = readonly LimitWindow[];

export const MAX_TRACKED_KEYS = 10_000;

/** A qué se le cuenta una IP: la misma IPv4, o el prefijo /64 de una IPv6 ya normalizada. */
export function limitKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head = "", tail] = ip.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === undefined || tail === "" ? [] : tail.split(":");
  const missing = Math.max(0, 8 - left.length - right.length);
  const groups = [...left, ...new Array<string>(missing).fill("0"), ...right];
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

interface Entry {
  readonly windows: { count: number; resetAt: number }[];
  lockedUntil: number;
}

export interface IpLimiterOptions {
  readonly spec: LimitSpec;
  readonly clock: Clock;
  readonly maxTracked?: number;
}

export class IpLimiter {
  /** Intentos rechazados desde que arrancó (métricas). */
  locked = 0;
  private readonly spec: LimitSpec;
  private readonly clock: Clock;
  private readonly maxTracked: number;
  private readonly entries = new Map<string, Entry>();

  constructor({ spec, clock, maxTracked = MAX_TRACKED_KEYS }: IpLimiterOptions) {
    this.spec = spec;
    this.clock = clock;
    this.maxTracked = maxTracked;
  }

  /** Direcciones recordadas ahora (para las pruebas de memoria). */
  get tracked(): number {
    return this.entries.size;
  }

  /** Cuánto falta (en ms) para que termine la espera de la IP, o 0 si no está en espera. */
  lockedFor(ip: string | null): number {
    if (ip === null) return 0;
    const entry = this.entries.get(limitKey(ip));
    return entry ? Math.max(0, entry.lockedUntil - this.clock.now()) : 0;
  }

  /**
   * Cuenta un intento. Devuelve la espera que empieza con él (en ms), o 0 si no se pasó ningún
   * límite. Al pasarse, esa ventana y las más cortas vuelven a cero, y las más largas siguen sumando.
   */
  hit(ip: string | null): number {
    if (ip === null) return 0;
    const now = this.clock.now();
    const entry = this.entryOf(limitKey(ip), now);
    entry.windows.forEach((window, index) => {
      if (now >= window.resetAt) {
        window.count = 0;
        window.resetAt = now + (this.spec[index]?.windowMs ?? 0);
      }
      window.count++;
    });
    for (let index = this.spec.length - 1; index >= 0; index--) {
      const limit = this.spec[index];
      const window = entry.windows[index];
      if (!limit || !window || window.count <= limit.max) continue;
      const until = limit.waitMs === undefined ? window.resetAt : now + limit.waitMs;
      entry.lockedUntil = Math.max(entry.lockedUntil, until);
      for (const shorter of entry.windows.slice(0, index + 1)) shorter.count = 0;
      return entry.lockedUntil - now;
    }
    return 0;
  }

  private entryOf(key: string, now: number): Entry {
    const known = this.entries.get(key);
    if (known) return known;
    if (this.entries.size >= this.maxTracked) this.prune(now);
    const entry: Entry = {
      windows: this.spec.map(() => ({ count: 0, resetAt: 0 })),
      lockedUntil: 0,
    };
    this.entries.set(key, entry);
    return entry;
  }

  /** Quita lo vencido y, si sigue lleno, lo más antiguo. */
  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now >= entry.lockedUntil && entry.windows.every((w) => now >= w.resetAt))
        this.entries.delete(key);
    }
    for (const key of this.entries.keys()) {
      if (this.entries.size < this.maxTracked) return;
      this.entries.delete(key);
    }
  }
}

/** Los límites por IP de una instancia. */
export interface IpLimits {
  /** `room.join` con `room.not_found`. */
  readonly join: IpLimiter;
  /** `room.create`. */
  readonly create: IpLimiter;
  /** Aperturas de conexión. */
  readonly connect: IpLimiter;
  /** Comandos de quien ya está en una sala (salvo `sys.ping` y `presence.select`). */
  readonly events: IpLimiter;
}

export type IpLimitSpecs = Readonly<Record<keyof IpLimits, LimitSpec>>;

export function createIpLimits(clock: Clock, specs: IpLimitSpecs): IpLimits {
  return {
    join: new IpLimiter({ spec: specs.join, clock }),
    create: new IpLimiter({ spec: specs.create, clock }),
    connect: new IpLimiter({ spec: specs.connect, clock }),
    events: new IpLimiter({ spec: specs.events, clock }),
  };
}
