// El servidor completo sobre una base de datos ya migrada: catálogo de puzzles (con la comprobación
// de que hay puzzles de cada dificultad), registro con group commit, transporte `ws` y salas. Lo usan
// el punto de entrada y la demostración.
import { createNormalMode } from "@sudoku-killer/game";
import { PARAMS_V1 } from "@sudoku-killer/scoring";
import type { Database } from "./db/database.ts";
import { AccessGate } from "./infra/access.ts";
import { systemClock, type Clock } from "./infra/clock.ts";
import { systemIds, systemRandom } from "./infra/random.ts";
import { WsTransport } from "./infra/ws-transport.ts";
import type { Logger } from "./log/logger.ts";
import { METRICS_INTERVAL_MS, startMetrics } from "./log/metrics.ts";
import { createMatchRepository } from "./match/repository.ts";
import { EventWriter } from "./match/sink.ts";
import { createPuzzleCatalog } from "./puzzles/catalog.ts";
import { createPuzzleRepository } from "./puzzles/repository.ts";
import { CLOSE_GOING_AWAY } from "./rooms/limits.ts";
import { RoomServer } from "./rooms/server.ts";

export interface AppOptions {
  readonly db: Database;
  readonly host: string;
  readonly port: number;
  readonly allowedOrigins: readonly string[];
  readonly logger: Logger;
  readonly clock?: Clock;
  /** El hash de la clave de acceso del grupo; `null` o ausente, sin clave. */
  readonly accessKeyHash?: string | null;
  /** Proxies de confianza delante del servidor. */
  readonly trustProxyHops?: number;
  /** Cada cuánto se escribe la línea `metrics`; 0 para no escribirla. */
  readonly metricsIntervalMs?: number;
}

export interface App {
  readonly server: RoomServer;
  /** El puerto en que escucha (con el puerto 0, el que asignó el sistema). */
  readonly port: number;
  /** Partidas reconstruidas al arrancar. */
  readonly restored: number;
  /** Apagado ordenado: escribe lo pendiente y cierra las conexiones con 1001. */
  stop(): Promise<void>;
}

export async function startApp({
  db,
  host,
  port,
  allowedOrigins,
  logger,
  clock = systemClock,
  accessKeyHash = null,
  trustProxyHops = 0,
  metricsIntervalMs = METRICS_INTERVAL_MS,
}: AppOptions): Promise<App> {
  const catalog = await createPuzzleCatalog(createPuzzleRepository(db));
  const repository = createMatchRepository(db);
  const sink = new EventWriter({ repository, clock, logger });
  const access = new AccessGate({ hash: accessKeyHash, clock });
  const transport = new WsTransport({
    host,
    port,
    allowedOrigins,
    clock,
    logger,
    access,
    trustProxyHops,
  });
  const server = new RoomServer({
    transport,
    clock,
    random: systemRandom,
    ids: systemIds,
    catalog,
    sink,
    repository,
    logger,
    mode: createNormalMode(PARAMS_V1),
  });
  const restored = await server.start();
  const stopMetrics =
    metricsIntervalMs > 0
      ? startMetrics({
          sources: { transport, rooms: server.rooms, writer: sink, access },
          clock,
          logger,
          intervalMs: metricsIntervalMs,
        })
      : () => undefined;
  return {
    server,
    port: transport.port,
    restored,
    stop: () => {
      stopMetrics();
      return server.stop(CLOSE_GOING_AWAY, "server shutting down");
    },
  };
}
