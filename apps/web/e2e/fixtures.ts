// Fixtures de E2E: el servidor de salas real (PGlite con el banco de pruebas, reloj del sistema) en
// cada worker, y el inspector de filtración (SPEC §8.3) sobre el tráfico WS que captura Playwright:
// cada mensaje que recibe cada página se revisa, y la prueba falla si hay alguna violación (T-31.1).
// El servidor escucha detrás de un proxy TCP de prueba en `E2E_WS_PORT`, que no pierde nada salvo
// que una prueba lo pida (`loseServerClose`: el cierre se pierde, como en el proxy de Render, T-39.16).
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { createNormalMode, type MatchEvent } from "@sudoku-killer/game";
import type { ServerEnvelope } from "@sudoku-killer/protocol";
import { PARAMS_V1 } from "@sudoku-killer/scoring";
import { systemClock } from "../../server/src/infra/clock.ts";
import { systemIds, systemRandom } from "../../server/src/infra/random.ts";
import {
  ACCESS_FAILURE_WINDOW_MS,
  AccessGate,
  hashAccessKey,
} from "../../server/src/infra/access.ts";
import type { Clock } from "../../server/src/infra/clock.ts";
import type { Link, LinkHandlers, Transport } from "../../server/src/infra/transport.ts";
import { WsTransport } from "../../server/src/infra/ws-transport.ts";
import { silentLogger } from "../../server/src/log/logger.ts";
import { createMatchRepository } from "../../server/src/match/repository.ts";
import { EventWriter } from "../../server/src/match/sink.ts";
import { RoomServer } from "../../server/src/rooms/server.ts";
import { LeakInspector } from "../../server/test/helpers/inspector.ts";
import { lossyProxy, type LossyProxy } from "../../server/test/helpers/lossy-proxy.ts";
import { FaultyRepository, testBank } from "../../server/test/helpers/server.ts";
import { E2E_ORIGIN, E2E_WS_PORT } from "../playwright.config.ts";

/** El puerto del servidor de salas, detrás del proxy de prueba que escucha en `E2E_WS_PORT`. */
const E2E_SERVER_PORT = E2E_WS_PORT + 1;

export interface GameServer {
  /** El servidor vivo (otro tras `restart`). */
  readonly server: RoomServer;
  readonly inspector: LeakInspector;
  /** Un inspector nuevo con las mismas fuentes (soluciones y celdas bloqueadas), para el control. */
  newInspector(): LeakInspector;
  /** Las conexiones abiertas en el servidor, por la que se puede enviar un mensaje de control. */
  links(): readonly TappedLink[];
  /** La conexión abierta de un jugador (por el apodo de su `room.create` o `room.join`). */
  linkOf(nickname: string): TappedLink | undefined;
  /** Verificación negativa del caos: los reenvíos llegan con otro `id` (ver `TappedTransport`). */
  breakResend(broken: boolean): void;
  /** La solución de la partida de una sala (solo en las pruebas). */
  solution(code: string): readonly number[];
  /**
   * Reinicio del servidor (E-15): las salas del proceso viejo dejan de procesar, lo ya aceptado por
   * el group commit se escribe, las conexiones se cierran con 1012 y arranca un servidor nuevo sobre
   * la misma base y el mismo puerto, que reconstruye las partidas desde el registro. Devuelve
   * cuántas reconstruyó.
   */
  restart(): Promise<number>;
  /** Hace fallar (o vuelve a funcionar) la base de datos al confirmar y al reconstruir (E-16). */
  failDatabase(failing: boolean): void;
  /** El registro confirmado de una partida. */
  events(matchId: string): Promise<MatchEvent[]>;
  /** Pide (o deja de pedir, con `null`) la clave de acceso del grupo en el handshake (R-39). */
  requireAccessKey(key: string | null): void;
  /**
   * El proxy delante del servidor pierde (o deja de perder) el cierre del servidor en las
   * conexiones nuevas: el 4003 no llega nunca, como detrás del proxy de Render (T-39.16).
   */
  loseServerClose(lose: boolean): void;
  /** Olvida las claves que no valieron y las esperas por IP (pasa la ventana de `AccessGate`). */
  forgetAccessFailures(): void;
  /** El servidor «se duerme»: deja de escuchar en su puerto hasta `wake`. */
  sleep(): Promise<void>;
  /** Vuelve a arrancar sobre la misma base y el mismo puerto (si estaba dormido). */
  wake(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Una conexión real vista por el fixture, con fallas a pedido para el caos: sabe de quién es
 * (por su `room.create` o `room.join`), puede cerrarse justo después de entregar el próximo comando que cambia el
 * estado, antes de su respuesta (E-07), y puede declarar más bytes encolados de los que tiene, para
 * que el servidor tome su propio camino de saturación (E-17).
 */
export class TappedLink implements Link {
  nickname: string | null = null;
  /** Bytes que se suman a `bufferedAmount` (E-17). */
  extraBuffered = 0;
  /** Se cierra después de entregar el próximo comando de estos tipos (E-07). */
  dropAfter: ReadonlySet<string> | null = null;
  readonly inner: Link;

  constructor(inner: Link) {
    this.inner = inner;
  }

  send(text: string): void {
    this.inner.send(text);
  }

  get bufferedAmount(): number {
    return this.inner.bufferedAmount + this.extraBuffered;
  }

  close(code: number, reason: string): void {
    this.inner.close(code, reason);
  }
}

/** El transporte `ws` real, con registro de las conexiones abiertas (para el control y el caos). */
class TappedTransport implements Transport {
  readonly open = new Set<TappedLink>();
  /**
   * Verificación negativa del caos: el reenvío de un comando llega con un `id` nuevo, como un
   * cliente que no conservara el `id` (E-07).
   */
  breakResend = false;
  private readonly seenIds = new Set<string>();
  private readonly inner: Transport;

  constructor(inner: Transport) {
    this.inner = inner;
  }

  start(accept: (link: Link) => LinkHandlers): Promise<void> {
    return this.inner.start((raw) => {
      const link = new TappedLink(raw);
      this.open.add(link);
      const handlers = accept(link);
      return {
        message: (text) => {
          const parsed = parse(text);
          if (parsed?.type === "room.join" || parsed?.type === "room.create")
            link.nickname = parsed.nickname ?? null;
          let delivered = text;
          if (parsed?.id !== undefined && parsed.type !== "sys.ping") {
            if (this.breakResend && this.seenIds.has(parsed.id))
              delivered = text.replace(`"id":"${parsed.id}"`, `"id":"${parsed.id}-again"`);
            this.seenIds.add(parsed.id);
          }
          handlers.message(delivered);
          if (parsed && link.dropAfter?.has(parsed.type)) {
            link.dropAfter = null;
            link.close(1011, "chaos");
          }
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
  const repository = new FaultyRepository(createMatchRepository(db));
  let live: { server: RoomServer; transport: TappedTransport; sink: EventWriter } | null = null;
  // Sin clave salvo en las pruebas de R-39; sobrevive a los reinicios. Su reloj se adelanta para
  // olvidar las esperas por IP (en las E2E, todas las páginas llegan desde 127.0.0.1).
  let skew = 0;
  const accessClock: Clock = { ...systemClock, now: () => systemClock.now() + skew };
  const access = new AccessGate({ hash: null, clock: accessClock });
  let asleep = false;
  let losing = false;
  let proxy: LossyProxy | null = null;
  const openProxy = async () => {
    proxy = await lossyProxy(E2E_SERVER_PORT, {
      port: E2E_WS_PORT,
      mode: losing ? "close" : "pass",
    });
  };
  const current = () => {
    if (!live) throw new Error("No server");
    return live;
  };
  /** Arranca un servidor (el primero o el que sigue a un reinicio) sobre la misma base. */
  const boot = async () => {
    const transport = new TappedTransport(
      new WsTransport({
        host: "127.0.0.1",
        port: E2E_SERVER_PORT,
        allowedOrigins: [E2E_ORIGIN],
        clock: systemClock,
        logger: silentLogger,
        access,
      }),
    );
    const sink = new EventWriter({ repository, clock: systemClock, logger: silentLogger });
    const server = new RoomServer({
      transport,
      clock: systemClock,
      random: systemRandom,
      ids: systemIds,
      catalog,
      sink,
      repository,
      logger: silentLogger,
      mode: createNormalMode(PARAMS_V1),
    });
    live = { server, transport, sink };
    return server.start();
  };
  await boot();
  await openProxy();
  const newInspector = () =>
    new LeakInspector({
      solutions: () => solutions,
      lockedValue: (matchId, cell) => {
        for (const room of current().server.rooms.values()) {
          const state = room.match?.state;
          const locked = state?.id === matchId ? state.cells[cell] : undefined;
          if (locked?.status === "locked") return locked.value;
        }
        return undefined;
      },
    });
  return {
    get server() {
      return current().server;
    },
    inspector: newInspector(),
    newInspector,
    links: () => [...current().transport.open],
    linkOf: (nickname) => [...current().transport.open].find((l) => l.nickname === nickname),
    breakResend(broken) {
      current().transport.breakResend = broken;
    },
    solution(code) {
      const match = current().server.rooms.get(code)?.match;
      if (!match) throw new Error(`No match in ${code}`);
      return match.solution;
    },
    async restart() {
      const old = current();
      for (const room of [...old.server.rooms.values()]) room.deleted = true;
      await old.sink.drain();
      await old.transport.stop(1012, "service restart");
      return boot();
    },
    failDatabase(failing) {
      repository.failing = failing;
    },
    events: (matchId) => repository.events(matchId),
    requireAccessKey(key) {
      access.hash = key === null ? null : hashAccessKey(key);
    },
    loseServerClose(lose) {
      losing = lose;
      if (proxy) proxy.mode = lose ? "close" : "pass";
    },
    forgetAccessFailures() {
      skew += ACCESS_FAILURE_WINDOW_MS;
    },
    async sleep() {
      if (asleep) return;
      const old = current();
      for (const room of [...old.server.rooms.values()]) room.deleted = true;
      await old.sink.drain();
      await old.transport.stop(1001, "sleeping");
      // Nadie escucha en el puerto, como un servidor dormido.
      await proxy?.close();
      proxy = null;
      asleep = true;
    },
    async wake() {
      if (!asleep) return;
      asleep = false;
      await boot();
      await openProxy();
    },
    async stop() {
      await proxy?.close();
      await current().transport.stop(1001, "e2e over");
    },
  };
}

/** El tipo, el `id` y el apodo (en `room.join`) de un mensaje entrante, si se puede leer. */
function parse(text: string): { type: string; id?: string; nickname?: string } | null {
  try {
    const message = JSON.parse(text) as {
      type?: unknown;
      id?: unknown;
      payload?: { nickname?: unknown };
    };
    if (typeof message.type !== "string") return null;
    return {
      type: message.type,
      ...(typeof message.id === "string" ? { id: message.id } : {}),
      ...(typeof message.payload?.nickname === "string"
        ? { nickname: message.payload.nickname }
        : {}),
    };
  } catch {
    return null;
  }
}

let sockets = 0;

/** Junta las violaciones de la CSP del sitio (S-05) que la página informa en la consola. */
export function watchCsp(page: Page, violations: string[]): void {
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy/i.test(message.text()))
      violations.push(message.text());
  });
}

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
    const csp: string[] = [];
    await provide(async ({ context } = {}) => {
      const target = context ?? (await browser.newContext());
      if (!context) contexts.push(target);
      const page = await target.newPage();
      inspect(page, game.inspector);
      watchCsp(page, csp);
      return page;
    });
    for (const context of contexts) await context.close();
    expect(csp, "Content-Security-Policy violations (S-05)").toEqual([]);
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
