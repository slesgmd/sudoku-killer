// Transporte de producción con `ws` (ADR 0002): una sola ruta, `/ws`, sobre un servidor HTTP.
// - El handshake solo se acepta desde los orígenes permitidos; uno ausente o ajeno recibe 403
//   (protección contra conexiones desde otros sitios).
// - `maxPayload` de 16 KiB: un mensaje más grande cierra con 1009 (lo hace `ws`).
// - `permessage-deflate` desactivado.
// - Heartbeat: ping cada 15 s; si no llegó el pong del anterior, la conexión se termina.
// - Los mensajes binarios no son del protocolo: llegan al servidor como texto inválido.
// - `GET /healthz` responde 204 sin cuerpo (F12): el chequeo del hosting y el precalentamiento de
//   la web. Cualquier otra petición HTTP recibe 404.
// - Clave de acceso del grupo (F12, R-39): llega como subprotocolo; si no vale, la conexión se abre
//   y se cierra en el acto con 4003, sin llegar a las salas. Una IP con demasiados fallos recibe
//   429 en el handshake. La clave nunca se registra.
// - Plazos del HTTP (F12, S-06): 10 s para recibir las cabeceras y la petición entera (Node trae
//   60 s y 300 s); no afectan a un WebSocket ya abierto. Tope de conexiones por IP (F12, S-01).
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { ACCESS_PROTOCOL, CLOSE_ACCESS_DENIED } from "@sudoku-killer/protocol";
import { WebSocketServer, type WebSocket } from "ws";
import type { Logger } from "../log/logger.ts";
import type { AccessGate } from "./access.ts";
import type { Clock } from "./clock.ts";
import type { Link, LinkHandlers, Transport } from "./transport.ts";

export const WS_PATH = "/ws";
export const HEALTH_PATH = "/healthz";
export const MAX_PAYLOAD_BYTES = 16 * 1024;
export const HEARTBEAT_MS = 15_000;
/**
 * Tope de conexiones abiertas a la vez (F11, `docs/seguridad.md` S-01): por encima, el handshake
 * recibe 503. Unas 6 veces las 300 de la prueba de carga.
 */
export const MAX_CONNECTIONS = 2_000;
/**
 * Tope de conexiones abiertas desde una misma IP (F12, S-01): una casa con el grupo entero y varias
 * pestañas, o la prueba de carga en el hosting (5 salas × 6), caben.
 */
export const MAX_CONNECTIONS_PER_IP = 40;
/** Plazo para recibir las cabeceras y la petición HTTP (F12, S-06). */
export const HTTP_TIMEOUT_MS = 10_000;

export interface WsTransportOptions {
  readonly host: string;
  readonly port: number;
  /** Orígenes permitidos, como `https://ejemplo.org` (sin barra final). */
  readonly allowedOrigins: readonly string[];
  readonly clock: Clock;
  readonly logger: Logger;
  readonly heartbeatMs?: number;
  /** Tope de conexiones abiertas (por defecto `MAX_CONNECTIONS`). */
  readonly maxConnections?: number;
  /** La clave de acceso del grupo (F12); sin ella, no se pide. */
  readonly access?: AccessGate;
  /** Proxies de confianza delante del servidor (`TRUST_PROXY_HOPS`, F12). */
  readonly trustProxyHops?: number;
  /** Tope de conexiones por IP (por defecto `MAX_CONNECTIONS_PER_IP`). */
  readonly maxConnectionsPerIp?: number;
  /** Plazo del HTTP (por defecto `HTTP_TIMEOUT_MS`); las pruebas lo bajan. */
  readonly httpTimeoutMs?: number;
}

/**
 * La IP del cliente. Sin proxies de confianza, la del socket. Con `hops` proxies, cada uno agrega a
 * la derecha de `X-Forwarded-For` la dirección de quien le habló: la del cliente es la `hops`-ésima
 * desde el final, y lo que esté más a la izquierda lo escribió el cliente (no se usa).
 */
export function clientIp(request: IncomingMessage, hops: number): string {
  const socketIp = request.socket.remoteAddress ?? "unknown";
  if (hops <= 0) return socketIp;
  const header = request.headers["x-forwarded-for"];
  const entries = (Array.isArray(header) ? header.join(",") : (header ?? ""))
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  return entries.at(-hops) ?? socketIp;
}

/** Los subprotocolos que ofreció el cliente en el handshake. */
function offeredProtocols(request: IncomingMessage): string[] {
  const header = request.headers["sec-websocket-protocol"];
  return (header ?? "")
    .split(",")
    .map((protocol) => protocol.trim())
    .filter((protocol) => protocol !== "");
}

/** Un origen comparable: minúsculas y sin barra final. */
export function normalizeOrigin(origin: string): string {
  return origin.trim().toLowerCase().replace(/\/+$/, "");
}

const STATUS_TEXT = {
  403: "Forbidden",
  404: "Not Found",
  429: "Too Many Requests",
  503: "Service Unavailable",
} as const;

function reject(socket: Duplex, status: keyof typeof STATUS_TEXT): void {
  const text = STATUS_TEXT[status];
  socket.end(
    `HTTP/1.1 ${String(status)} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

export class WsTransport implements Transport {
  private readonly options: WsTransportOptions;
  private readonly allowed: ReadonlySet<string>;
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly alive = new Map<WebSocket, boolean>();
  private readonly perIp = new Map<string, number>();
  private cancelHeartbeat: (() => void) | null = null;

  constructor(options: WsTransportOptions) {
    this.options = options;
    this.allowed = new Set(options.allowedOrigins.map(normalizeOrigin));
  }

  /** Conexiones abiertas ahora (las que cuentan para el tope). */
  get openConnections(): number {
    return this.alive.size;
  }

  /** El puerto en que escucha (útil con el puerto 0 en las pruebas). */
  get port(): number {
    const address = this.http?.address();
    return typeof address === "object" && address ? address.port : this.options.port;
  }

  async start(accept: (link: Link) => LinkHandlers): Promise<void> {
    const { logger } = this.options;
    const wss = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_PAYLOAD_BYTES,
      perMessageDeflate: false,
      // Se elige `sk.v1` cuando se ofrece; la clave (`sk.k.…`) nunca vuelve en la respuesta.
      handleProtocols: (protocols) => (protocols.has(ACCESS_PROTOCOL) ? ACCESS_PROTOCOL : false),
    });
    const timeout = this.options.httpTimeoutMs ?? HTTP_TIMEOUT_MS;
    const http = createServer(
      {
        headersTimeout: timeout,
        requestTimeout: timeout,
        // Cada cuánto Node revisa esos plazos (por defecto, 30 s).
        connectionsCheckingInterval: Math.min(1_000, timeout),
      },
      (request, response) => {
        const path = new URL(request.url ?? "/", "http://localhost").pathname;
        const health =
          path === HEALTH_PATH && (request.method === "GET" || request.method === "HEAD");
        response.writeHead(health ? 204 : 404, {
          "content-length": "0",
          "cache-control": "no-store",
        });
        response.end();
      },
    );
    http.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (path !== WS_PATH) {
        reject(socket, 404);
        return;
      }
      const origin = request.headers.origin;
      if (origin === undefined || !this.allowed.has(normalizeOrigin(origin))) {
        // El origen rechazado no se registra completo: puede ser cualquier texto.
        logger.warn("websocket origin rejected", { hasOrigin: origin !== undefined });
        reject(socket, 403);
        return;
      }
      const ip = clientIp(request, this.options.trustProxyHops ?? 0);
      const access = this.options.access;
      if (access?.locked(ip)) {
        logger.warn("websocket access locked for an address");
        reject(socket, 429);
        return;
      }
      if (this.alive.size >= (this.options.maxConnections ?? MAX_CONNECTIONS)) {
        logger.warn("websocket connection limit reached", { open: this.alive.size });
        reject(socket, 503);
        return;
      }
      if (
        (this.perIp.get(ip) ?? 0) >= (this.options.maxConnectionsPerIp ?? MAX_CONNECTIONS_PER_IP)
      ) {
        logger.warn("websocket per-address connection limit reached");
        reject(socket, 503);
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        if (access && !access.admit(offeredProtocols(request), ip)) {
          logger.warn("websocket access denied");
          ws.close(CLOSE_ACCESS_DENIED, "access denied");
          return;
        }
        this.connected(ws, accept, ip);
      });
    });
    this.http = http;
    this.wss = wss;
    await new Promise<void>((resolve, reject) => {
      http.once("error", reject);
      http.listen(this.options.port, this.options.host, () => {
        http.off("error", reject);
        resolve();
      });
    });
    this.scheduleHeartbeat();
  }

  private connected(ws: WebSocket, accept: (link: Link) => LinkHandlers, ip: string): void {
    this.alive.set(ws, true);
    this.perIp.set(ip, (this.perIp.get(ip) ?? 0) + 1);
    const link: Link = {
      send: (text) => {
        if (ws.readyState === ws.OPEN) ws.send(text);
      },
      get bufferedAmount() {
        return ws.bufferedAmount;
      },
      close: (code, reason) => {
        ws.close(code, reason);
      },
    };
    const handlers = accept(link);
    let closed = false;
    const done = () => {
      if (closed) return;
      closed = true;
      this.alive.delete(ws);
      const left = (this.perIp.get(ip) ?? 1) - 1;
      if (left > 0) this.perIp.set(ip, left);
      else this.perIp.delete(ip);
      handlers.closed();
    };
    ws.on("pong", () => {
      this.alive.set(ws, true);
    });
    ws.on("message", (data, isBinary) => {
      // Un mensaje binario no es JSON del protocolo: el servidor responde `bad_request`.
      handlers.message(isBinary ? "" : (data as Buffer).toString("utf8"));
    });
    ws.on("close", done);
    ws.on("error", (error) => {
      this.options.logger.debug("websocket error", { error: error.message });
    });
  }

  /** Cada 15 s: se termina la conexión que no respondió el ping anterior, y se envía uno nuevo. */
  private scheduleHeartbeat(): void {
    const { clock, heartbeatMs = HEARTBEAT_MS } = this.options;
    this.cancelHeartbeat = clock.setTimeout(() => {
      for (const [ws, alive] of [...this.alive]) {
        if (!alive) {
          ws.terminate();
          continue;
        }
        this.alive.set(ws, false);
        ws.ping();
      }
      this.scheduleHeartbeat();
    }, heartbeatMs);
  }

  async stop(code: number, reason: string): Promise<void> {
    this.cancelHeartbeat?.();
    this.cancelHeartbeat = null;
    for (const ws of this.alive.keys()) ws.close(code, reason);
    const wss = this.wss;
    const http = this.http;
    await new Promise<void>((resolve) => {
      if (wss) {
        wss.close(() => {
          resolve();
        });
      } else {
        resolve();
      }
    });
    await new Promise<void>((resolve) => {
      if (!http) {
        resolve();
        return;
      }
      http.closeAllConnections();
      http.close(() => {
        resolve();
      });
    });
  }
}
