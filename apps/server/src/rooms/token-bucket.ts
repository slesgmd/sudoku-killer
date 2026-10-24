// Cubeta de tokens para el límite de velocidad por conexión (SPEC §4.8): se llena a `rate` tokens por
// segundo, hasta `burst`, y cada mensaje gasta uno.
import type { Clock } from "../infra/clock.ts";

export interface BucketSpec {
  readonly rate: number;
  readonly burst: number;
}

export class TokenBucket {
  private tokens: number;
  private updatedAt: number;
  private readonly spec: BucketSpec;
  private readonly clock: Clock;

  constructor(spec: BucketSpec, clock: Clock) {
    this.spec = spec;
    this.clock = clock;
    this.tokens = spec.burst;
    this.updatedAt = clock.now();
  }

  /** Gasta un token si hay; si no, devuelve `false`. */
  take(): boolean {
    const now = this.clock.now();
    const elapsed = Math.max(0, now - this.updatedAt) / 1000;
    this.tokens = Math.min(this.spec.burst, this.tokens + elapsed * this.spec.rate);
    this.updatedAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
