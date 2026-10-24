// Confirmación de los eventos antes de difundirlos (ADR 0004, group commit): las salas entregan sus
// eventos y esperan la confirmación. Cada 10 ms, o en cuanto hay 64 eventos, se escribe un lote en una
// sola transacción, de a un lote por vez y en orden.
//
// Si la base de datos falla (E-16), el lote se reintenta y, mientras tanto, el destino queda
// `unavailable`: las salas responden `server.unavailable` a los comandos que cambian el estado. Si
// el fallo dura 10 s, los lotes pendientes se rechazan: sus salas se cierran y se reconstruyen desde
// lo confirmado, así que ningún cliente ve un evento que no quedó en la base.
import type { MatchEvent } from "@sudoku-killer/game";
import type { Clock } from "../infra/clock.ts";
import type { Logger } from "../log/logger.ts";
import type { MatchRecord, MatchRepository } from "./repository.ts";

export interface SinkEntry {
  readonly match?: MatchRecord;
  readonly matchId: string;
  readonly events: readonly MatchEvent[];
}

export interface EventSink {
  /** Se resuelve cuando los eventos quedan confirmados; se rechaza si se perdieron (E-16). */
  write(entry: SinkEntry): Promise<void>;
  /** La base de datos no confirma: los comandos que cambian el estado se rechazan. */
  readonly unavailable: boolean;
  /** Se resuelve en cuanto el destino pasa a `unavailable` (para no esperar una confirmación que no llega). */
  stalled(): Promise<void>;
  /** La base de datos volvió a responder (lo avisa quien la consultó con éxito). */
  recovered(): void;
  /** Escribe lo pendiente ya (apagado ordenado). */
  drain(): Promise<void>;
}

export interface EventWriterOptions {
  readonly repository: MatchRepository;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Cómo esperar antes de escribir un lote: por defecto, 10 ms del reloj. */
  readonly schedule?: (flush: () => void) => void;
  readonly maxBatchEvents?: number;
  readonly retryMs?: number;
  readonly giveUpMs?: number;
}

export const COMMIT_DELAY_MS = 10;
export const COMMIT_BATCH_EVENTS = 64;
export const COMMIT_RETRY_MS = 1_000;
/** E-16: con 10 s de fallo, las salas afectadas se reconstruyen desde lo confirmado. */
export const COMMIT_GIVE_UP_MS = 10_000;

interface Pending {
  readonly entry: SinkEntry;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export class EventWriter implements EventSink {
  private queue: Pending[] = [];
  private flushing = false;
  private scheduled = false;
  private failingSince: number | null = null;
  private stall = deferred();
  private readonly options: Required<Omit<EventWriterOptions, "schedule">> & {
    readonly schedule: (flush: () => void) => void;
  };

  constructor(options: EventWriterOptions) {
    const { clock } = options;
    this.options = {
      maxBatchEvents: COMMIT_BATCH_EVENTS,
      retryMs: COMMIT_RETRY_MS,
      giveUpMs: COMMIT_GIVE_UP_MS,
      schedule: (flush) => {
        clock.setTimeout(flush, COMMIT_DELAY_MS);
      },
      ...options,
    };
  }

  get unavailable(): boolean {
    return this.failingSince !== null;
  }

  stalled(): Promise<void> {
    return this.stall.promise;
  }

  write(entry: SinkEntry): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ entry, resolve, reject });
      this.kick();
    });
  }

  recovered(): void {
    if (this.failingSince === null) return;
    this.failingSince = null;
    this.stall = deferred();
    this.options.logger.info("database recovered");
    this.kick();
  }

  async drain(): Promise<void> {
    while (this.queue.length > 0 && !this.unavailable) {
      if (!this.flushing) await this.flush();
      else await new Promise((resolve) => setImmediate(resolve));
    }
  }

  private queuedEvents(): number {
    return this.queue.reduce((sum, p) => sum + p.entry.events.length, 0);
  }

  private kick(): void {
    if (this.scheduled || this.flushing || this.unavailable || this.queue.length === 0) return;
    this.scheduled = true;
    const run = () => {
      this.scheduled = false;
      void this.flush();
    };
    if (this.queuedEvents() >= this.options.maxBatchEvents) queueMicrotask(run);
    else this.options.schedule(run);
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const batch: Pending[] = [];
    let count = 0;
    while (this.queue.length > 0 && (batch.length === 0 || count < this.options.maxBatchEvents)) {
      const next = this.queue.shift();
      if (!next) break;
      batch.push(next);
      count += next.entry.events.length;
    }
    try {
      await this.options.repository.commit({
        matches: batch.flatMap((p) => (p.entry.match ? [p.entry.match] : [])),
        events: batch.flatMap((p) =>
          p.entry.events.map((event) => ({ matchId: p.entry.matchId, event })),
        ),
      });
      for (const pending of batch) pending.resolve();
      this.flushing = false;
      this.recovered();
      this.kick();
    } catch (error) {
      this.flushing = false;
      this.failed(batch, error);
    }
  }

  private failed(batch: Pending[], error: unknown): void {
    const { clock, logger, giveUpMs, retryMs } = this.options;
    const now = clock.now();
    if (this.failingSince === null) {
      this.failingSince = now;
      logger.error("database commit failed", { error });
      this.stall.resolve();
    }
    if (now - this.failingSince >= giveUpMs) {
      const lost = [...batch, ...this.queue];
      this.queue = [];
      logger.error("database unavailable: dropping unconfirmed events", { entries: lost.length });
      const reason = new Error("events not confirmed");
      for (const pending of lost) pending.reject(reason);
      return;
    }
    this.queue = [...batch, ...this.queue];
    clock.setTimeout(() => void this.flush(), retryMs);
  }
}
