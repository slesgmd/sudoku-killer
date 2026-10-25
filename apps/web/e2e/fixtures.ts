// Fixtures de E2E: el servidor de salas real (PGlite con el banco de pruebas, reloj del sistema) en
// cada worker, y el inspector de filtración (SPEC §8.3) sobre el tráfico WS que captura Playwright:
// cada mensaje que recibe cada página se revisa, y la prueba falla si hay alguna violación (T-31.1).
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { createNormalMode } from "@sudoku-killer/game";
import type { ServerEnvelope } from "@sudoku-killer/protocol";
import { PARAMS_V1 } from "@sudoku-killer/scoring";
import { systemClock } from "../../server/src/infra/clock.ts";
import { systemIds, systemRandom } from "../../server/src/infra/random.ts";
import type { Link, LinkHandlers, Transport } from "../../server/src/infra/transport.ts";
import { WsTransport } from "../../server/src/infra/ws-transport.ts";
import { silentLogger } from "../../server/src/log/logger.ts";
import { createMatchRepository } from "../../server/src/match/repository.ts";
import { EventWriter } from "../../server/src/match/sink.ts";
import { RoomServer } from "../../server/src/rooms/server.ts";
import { LeakInspector } from "../../server/test/helpers/inspector.ts";
import { testBank } from "../../server/test/helpers/server.ts";
import { E2E_ORIGIN, E2E_WS_PORT } from "../playwright.config.ts";

export interface GameServer {
  readonly server: RoomServer;
  readonly inspector: LeakInspector;
  /** Un inspector nuevo con las mismas fuentes (soluciones y celdas bloqueadas), para el control. */
  newInspector(): LeakInspector;
  /** Las conexiones abiertas en el servidor, por la que se puede enviar un mensaje de control. */
  links(): readonly Link[];
  /** La solución de la partida de una sala (solo en las pruebas). */
  solution(code: string): readonly number[];
  stop(): Promise<void>;
}

/** El transporte `ws` real, con registro de las conexiones abiertas (para el control). */
class TappedTransport implements Transport {
  readonly open = new Set<Link>();
  private readonly inner: Transport;

  constructor(inner: Transport) {
    this.inner = inner;
  }

  start(accept: (link: Link) => LinkHandlers): Promise<void> {
    return this.inner.start((link) => {
      this.open.add(link);
      const handlers = accept(link);
      return {
        message: (text) => {
          handlers.message(text);
        },
        closed: () => {
          this.open.delete(link);
          handlers.closed();
        },
      };
    });
  }

  stop(code: number, reason: string): Promise<void> {
    return this.inner.stop(code, reason);
  }
}

async function startGameServer(): Promise<GameServer> {
  const { db, client, catalog, solutions } = await testBank();
  await client.query("TRUNCATE match_events, matches");
  const repository = createMatchRepository(db);
  const transport = new TappedTransport(
    new WsTransport({
      host: "127.0.0.1",
      port: E2E_WS_PORT,
      allowedOrigins: [E2E_ORIGIN],
      clock: systemClock,
      logger: silentLogger,
    }),
  );
  const server = new RoomServer({
    transport,
    clock: systemClock,
    random: systemRandom,
    ids: systemIds,
    catalog,
    sink: new EventWriter({ repository, clock: systemClock, logger: silentLogger }),
    repository,
    logger: silentLogger,
    mode: createNormalMode(PARAMS_V1),
  });
  await server.start();
  const newInspector = () =>
    new LeakInspector({
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
    server,
    inspector: newInspector(),
    newInspector,
    links: () => [...transport.open],
    solution(code) {
      const match = server.rooms.get(code)?.match;
      if (!match) throw new Error(`No match in ${code}`);
      return match.solution;
    },
    stop: () => transport.stop(1001, "e2e over"),
  };
}

let sockets = 0;

/** Revisa con el inspector cada mensaje que recibe la página por WebSocket. */
export function inspect(page: Page, inspector: LeakInspector): void {
  page.on("websocket", (ws) => {
    const id = ++sockets;
    ws.on("framereceived", ({ payload }) => {
      inspector.check(id, typeof payload === "string" ? payload : payload.toString("utf8"));
    });
  });
}

/** La página del control del inspector (como el fixture de control de T-31.2). */
export interface ControlPage {
  readonly page: Page;
  /** Un inspector propio, para no ensuciar el de las demás pruebas. */
  readonly inspector: LeakInspector;
  /** Envía un mensaje a la página desde el servidor, por su conexión real. */
  readonly inject: (text: string) => void;
}

interface Fixtures {
  /** Abre una página nueva (un contexto propio, como otra persona) con el inspector. */
  player: (options?: { context?: BrowserContext }) => Promise<Page>;
  /** Una página cuyo tráfico pasa por un inspector propio y a la que el servidor envía, a pedido, un mensaje de control. */
  controlPage: ControlPage;
}

export const test = base.extend<Fixtures, { game: GameServer }>({
  game: [
    // eslint-disable-next-line no-empty-pattern -- Playwright exige desestructurar los fixtures.
    async ({}, provide) => {
      const game = await startGameServer();
      await provide(game);
      await game.stop();
    },
    { scope: "worker", timeout: 120_000 },
  ],
  player: async ({ browser, game }, provide) => {
    const contexts: BrowserContext[] = [];
    const before = game.inspector.violations.length;
    const inspected = game.inspector.inspected;
    await provide(async ({ context } = {}) => {
      const target = context ?? (await browser.newContext());
      if (!context) contexts.push(target);
      const page = await target.newPage();
      inspect(page, game.inspector);
      return page;
    });
    for (const context of contexts) await context.close();
    expect(game.inspector.violations.slice(before), "leak inspector (SPEC §8.3)").toEqual([]);
    expect(game.inspector.inspected, "messages seen by the inspector").toBeGreaterThan(inspected);
  },

  controlPage: async ({ browser, game }, provide) => {
    const context = await browser.newContext();
    const before = new Set(game.links());
    const page = await context.newPage();
    const inspector = game.newInspector();
    inspect(page, inspector);
    await provide({
      page,
      inspector,
      inject: (text) => {
        const links = game.links().filter((link) => !before.has(link));
        if (links.length === 0) throw new Error("The control page has no connection");
        for (const link of links) link.send(text);
      },
    });
    await context.close();
  },
});

export { expect };

/** Crea una sala desde Entrar y devuelve su código. */
export async function createRoom(page: Page, nickname: string): Promise<string> {
  await page.goto("/#/entrar");
  await page.getByLabel("Tu apodo").fill(nickname);
  await page.getByRole("button", { name: "Crear sala nueva" }).click();
  await expect(page.getByRole("heading", { name: "Sala de espera" })).toBeVisible();
  const code = /#\/sala\/([A-Z0-9]{6})$/.exec(page.url())?.[1];
  if (!code) throw new Error(`No room code in ${page.url()}`);
  return code;
}

/** Abre el enlace de la sala (sin ficha, se abre Entrar con el código) y entra. */
export async function joinRoom(page: Page, code: string, nickname: string): Promise<void> {
  await page.goto(`/#/sala/${code}`);
  await expect(page.getByLabel("Código de la sala")).toHaveValue(code);
  await page.getByLabel("Tu apodo").fill(nickname);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

/** El botón de una celda (índice de 0 a 80). */
export function cell(page: Page, index: number) {
  const row = Math.floor(index / 9) + 1;
  const col = (index % 9) + 1;
  return page.getByRole("button", {
    name: new RegExp(`^Fila ${String(row)}, columna ${String(col)},`),
  });
}

/** Guarda los mensajes que recibe la página por WebSocket, ya interpretados. */
export function record(page: Page): ServerEnvelope[] {
  const seen: ServerEnvelope[] = [];
  page.on("websocket", (ws) => {
    ws.on("framereceived", ({ payload }) => {
      seen.push(
        JSON.parse(
          typeof payload === "string" ? payload : payload.toString("utf8"),
        ) as ServerEnvelope,
      );
    });
  });
  return seen;
}

/** Los cambios de conexión de un jugador que llegaron (`room.player_connection`), en orden. */
export function connections(seen: readonly ServerEnvelope[], playerId: string): string[] {
  return seen.flatMap((m) =>
    m.type === "room.player_connection" && m.payload.playerId === playerId
      ? [m.payload.connection]
      : [],
  );
}
