// Métricas básicas del servidor (F12h): una línea `metrics` en el log cada 60 s, que el panel del
// hosting muestra. Solo recuentos y tiempos: nunca códigos de sala, apodos, fichas, claves ni
// direcciones IP. Sirven para ver la carga real del grupo y los límites del plan gratuito (memoria,
// CPU del bucle de eventos y la espera de la base, ADR 0007).
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { AccessGate } from "../infra/access.ts";
import type { Clock } from "../infra/clock.ts";
import type { CommitStats } from "../match/sink.ts";
import type { RoomStore } from "../rooms/store.ts";
import type { Logger } from "./logger.ts";

export const METRICS_INTERVAL_MS = 60_000;

export interface MetricsSources {
  readonly transport: {
    readonly openConnections: number;
    readonly openAddresses: number;
    /** Handshakes con 429 desde que arrancó. */
    readonly locked: number;
    /** Handshakes sin IP conocida desde que arrancó (si no es 0, revisar `TRUST_PROXY_HOPS`). */
    readonly unknownAddresses: number;
  };
  readonly rooms: RoomStore;
  readonly writer: { takeStats(): CommitStats };
  readonly access: Pick<AccessGate, "denied" | "missing">;
}

export interface MetricsOptions {
  readonly sources: MetricsSources;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly intervalMs?: number;
  readonly memory?: () => { readonly rss: number; readonly heapUsed: number };
}

const MB = 1024 * 1024;
const round = (value: number) => Math.round(value * 10) / 10;

/** Empieza a escribir la línea `metrics`. Devuelve la función que la detiene. */
export function startMetrics({
  sources,
  clock,
  logger,
  intervalMs = METRICS_INTERVAL_MS,
  memory = () => process.memoryUsage(),
}: MetricsOptions): () => void {
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  const startedAt = clock.now();
  let denied = sources.access.denied;
  let missing = sources.access.missing;
  let locked = sources.transport.locked;
  let unknown = sources.transport.unknownAddresses;
  let cancel: (() => void) | null = null;

  const report = () => {
    let rooms = 0;
    let matches = 0;
    let players = 0;
    for (const room of sources.rooms.values()) {
      rooms++;
      if (room.state === "running") matches++;
      for (const member of room.members.values()) if (member.connection === "connected") players++;
    }
    const commits = sources.writer.takeStats();
    const { rss, heapUsed } = memory();
    const loopP95 = loop.count === 0 ? 0 : loop.percentile(95) / 1e6;
    loop.reset();
    logger.info("metrics", {
      uptimeS: Math.round((clock.now() - startedAt) / 1000),
      connections: sources.transport.openConnections,
      addresses: sources.transport.openAddresses,
      rooms,
      matchesRunning: matches,
      playersConnected: players,
      commits: commits.commits,
      events: commits.events,
      commitP95Ms: round(commits.p95Ms),
      commitMaxMs: round(commits.maxMs),
      eventLoopP95Ms: round(loopP95),
      rssMb: round(rss / MB),
      heapUsedMb: round(heapUsed / MB),
      accessDenied: sources.access.denied - denied,
      accessMissing: sources.access.missing - missing,
      accessLocked: sources.transport.locked - locked,
      addressUnknown: sources.transport.unknownAddresses - unknown,
    });
    denied = sources.access.denied;
    missing = sources.access.missing;
    locked = sources.transport.locked;
    unknown = sources.transport.unknownAddresses;
  };

  const schedule = () => {
    cancel = clock.setTimeout(() => {
      report();
      schedule();
    }, intervalMs);
  };
  schedule();
  return () => {
    cancel?.();
    cancel = null;
    loop.disable();
  };
}
