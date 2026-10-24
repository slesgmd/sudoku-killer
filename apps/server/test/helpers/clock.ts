// Reloj falso (SPEC §8.2): la hora solo avanza a mano y los temporizadores se disparan en orden,
// esperando entre uno y otro a que el servidor termine lo que tenga en cola.
import type { Clock } from "../../src/infra/clock.ts";

interface Timer {
  readonly at: number;
  readonly order: number;
  readonly fn: () => void;
  cancelled: boolean;
}

export class FakeClock implements Clock {
  private time: number;
  private order = 0;
  private timers: Timer[] = [];

  constructor(start = 1_700_000_000_000) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  setTimeout(fn: () => void, ms: number): () => void {
    const timer: Timer = {
      at: this.time + Math.max(0, ms),
      order: this.order++,
      fn,
      cancelled: false,
    };
    this.timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  }

  /** Temporizadores pendientes (sin los cancelados). */
  get pending(): number {
    return this.timers.filter((t) => !t.cancelled).length;
  }

  /**
   * Avanza `ms` milisegundos. Dispara los temporizadores que vencen, en orden de vencimiento (y de
   * creación a igual vencimiento), con `settle` después de cada uno.
   */
  async advance(ms: number, settle: () => Promise<void>): Promise<void> {
    const target = this.time + ms;
    for (;;) {
      this.timers = this.timers.filter((t) => !t.cancelled);
      let next: Timer | undefined;
      for (const timer of this.timers) {
        if (timer.at > target) continue;
        if (!next || timer.at < next.at || (timer.at === next.at && timer.order < next.order)) {
          next = timer;
        }
      }
      if (!next) break;
      this.time = Math.max(this.time, next.at);
      next.cancelled = true;
      next.fn();
      await settle();
    }
    this.time = target;
    await settle();
  }
}
