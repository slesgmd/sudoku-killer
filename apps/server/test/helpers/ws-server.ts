// El servidor de salas real sobre `ws` en 127.0.0.1 (puerto libre), con el banco de pruebas en PGlite,
// un reloj falso y el inspector de filtración (SPEC §8.3). Lo usan las pruebas del adaptador `ws`
// y las del cliente contra el servidor real (F10).
import { createRng } from "@sudoku-killer/engine";
import { seededIds } from "../../src/infra/random.ts";
import { WsTransport } from "../../src/infra/ws-transport.ts";
import { silentLogger } from "../../src/log/logger.ts";
import { createMatchRepository } from "../../src/match/repository.ts";
import { EventWriter } from "../../src/match/sink.ts";
import { RoomServer } from "../../src/rooms/server.ts";
import { FakeClock } from "./clock.ts";
import { LeakInspector } from "./inspector.ts";
import { mode, testBank } from "./server.ts";

export const TEST_ORIGIN = "http://localhost:5173";

export interface RunningWsServer {
  readonly port: number;
  readonly clock: FakeClock;
  readonly server: RoomServer;
  readonly inspector: LeakInspector;
  /** Las soluciones de los puzzles del banco de pruebas (para jugar y para el inspector). */
  readonly solutions: readonly (readonly number[])[];
  stop(): Promise<void>;
}

export async function startWsServer(): Promise<RunningWsServer> {
  const { db, client, catalog, solutions } = await testBank();
  await client.query("TRUNCATE match_events, matches");
  const clock = new FakeClock();
  const repository = createMatchRepository(db);
  const transport = new WsTransport({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [TEST_ORIGIN],
    clock,
    logger: silentLogger,
  });
  const server = new RoomServer({
    transport,
    clock,
    random: createRng(7),
    ids: seededIds(createRng(8)),
    catalog,
    sink: new EventWriter({
      repository,
      clock,
      logger: silentLogger,
      schedule: (flush) => {
        setImmediate(flush);
      },
    }),
    repository,
    logger: silentLogger,
    mode,
  });
  await server.start();
  const inspector = new LeakInspector({
    solutions: () => solutions,
    lockedValue: (matchId, cell) => {
      for (const room of server.rooms.values()) {
        const state = room.match?.state;
        const locked = state?.id === matchId ? state.cells[cell] : undefined;
        if (locked?.status === "locked") return locked.value;
      }
      return undefined;
    },
  });
  return {
    port: transport.port,
    clock,
    server,
    inspector,
    solutions,
    stop: () => transport.stop(1001, "test over"),
  };
}
