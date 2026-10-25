// Transporte hacia el servidor real por WebSocket (ADR 0002, SPEC §4.1).
// - La conexión se abre a pedido (`connect`) y se cierra al salir de la sala (`disconnect`), así un
//   cliente en el inicio no ocupa el servidor ni recibe el cierre 4002.
// - Si la conexión cae, se reintenta con espera exponencial y jitter, de 0,5 s a 5 s. Si no abre en
//   10 s, el estado pasa a `unavailable` y se sigue reintentando.
// - En el celular, al volver a primer plano, al restaurar la página desde la caché o al recuperar
//   la red, se reintenta al instante, sin esperar la espera exponencial.
// - 4001 (otra pestaña), 4000 (versión) y 4003 (clave de acceso, R-39) no se reintentan solos;
//   4002 (sin sala) deja `idle`.
// - El navegador no deja leer el estado de un handshake rechazado: lo ve como un cierre 1006, igual
//   que un servidor dormido. Tras un intento que no llegó a abrir, `probe` pregunta por HTTP qué
//   recibe el handshake (`GET /ws`, T-39.9): 429 deja `locked` y 403, `refused`, sin reintentar solos;
//   cualquier otra respuesta, o ninguna, sigue con la espera exponencial (T-39.10).
// - Cada intento ofrece los subprotocolos de `protocols` (`sk.v1` y la clave del grupo, F12), que se
//   leen en el momento: una clave recién escrita vale en el intento siguiente.
// - Con `access`, antes de abrir cada WebSocket se comprueba la clave guardada por HTTP
//   (`POST /access`, T-39.13): 204 abre el WebSocket, y también 404 (un servidor sin esa ruta); 401
//   deja `denied`, 429 `locked` y 403 `refused`, sin abrir ninguno; sin respuesta, o con otra, se
//   sigue con la espera exponencial. El proxy de Render pierde el cierre 4003 (T-39.16), así que no
//   se puede depender de él; queda como respaldo.
// - Cada mensaje entrante se valida con el esquema del protocolo; uno inválido se ignora.
// La implementación de WebSocket se inyecta: el navegador usa la suya y los bots Node, la de `ws`.
import {
  ACCESS_KEY_HEADER,
  ACCESS_PATH,
  CLOSE_ACCESS_DENIED,
  CLOSE_NO_ROOM,
  CLOSE_REPLACED,
  CLOSE_UNSUPPORTED,
  encodeAccessKey,
  parseServerEnvelope,
  type ServerEnvelope,
} from "@sudoku-killer/protocol";
import { probeUrl } from "./server-url.ts";
import { Listeners, type Transport, type TransportStatus } from "./types.ts";

/** Lo que el transporte usa de un WebSocket (el del navegador y el de `ws` lo cumplen). */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: { readonly code: number }) => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Dónde escuchar los eventos de la página que piden reconectar ya. */
export interface LifecycleTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface WsTransportOptions {
  readonly url: string;
  /** Crea el socket (por defecto, el WebSocket del entorno). */
  readonly open?: (url: string, protocols: readonly string[]) => SocketLike;
  /** Los subprotocolos de cada intento (por defecto, ninguno). */
  readonly protocols?: () => readonly string[];
  readonly scheduler?: Scheduler;
  /** Azar del jitter, en [0, 1). */
  readonly random?: () => number;
  /** `window` para `pageshow` y `online`; `null` para no escuchar. */
  readonly window?: LifecycleTarget | null;
  /** `document` para `visibilitychange`; `null` para no escuchar. */
  readonly document?: (LifecycleTarget & { readonly visibilityState?: string }) | null;
  /** Log de depuración: nunca recibe el contenido de los mensajes, solo su tipo. */
  readonly debug?: (message: string) => void;
  /**
   * El estado HTTP que recibiría ahora el handshake, o `null` si no se pudo saber (por defecto, no
   * se pregunta). Nunca rechaza.
   */
  readonly probe?: () => Promise<number | null>;
  /**
   * Comprueba una clave por HTTP: el estado de `POST /access`, o `null` si no hubo respuesta (por
   * defecto, no se comprueba). Nunca rechaza.
   */
  readonly access?: (key: string | null) => Promise<number | null>;
  /** La clave guardada, que `access` comprueba antes de cada intento (por defecto, ninguna). */
  readonly accessKey?: () => string | null;
}

export const RETRY_MIN_MS = 500;
export const RETRY_MAX_MS = 5000;
export const UNAVAILABLE_AFTER_MS = 10_000;
/** Plazo de la pregunta por HTTP: un servidor dormido no contesta, y se sigue reintentando. */
export const PROBE_TIMEOUT_MS = 3000;
/** Plazo de `POST /access`: más largo, porque el navegador puede hacer antes la consulta de CORS. */
export const ACCESS_TIMEOUT_MS = 10_000;

/** `probe` sobre `GET /ws` del mismo servidor que `wsUrl` (`ws` → `http`, `wss` → `https`). */
export function httpProbe(
  wsUrl: string,
  fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
): () => Promise<number | null> {
  const url = probeUrl(wsUrl);
  return async () => {
    try {
      const response = await fetcher(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      return response.status;
    } catch {
      return null;
    }
  };
}

/** `POST /access` en el mismo servidor (T-39.12): `https://<host>/access` (o `http` sin TLS). */
export function accessUrl(wsUrl: string): string {
  return new URL(ACCESS_PATH, probeUrl(wsUrl)).href;
}

/**
 * `access` sobre `POST /access` del mismo servidor que `wsUrl`: la clave va normalizada y en
 * base64url en `X-Sk-Access-Key`, nunca en la URL (T-39.12).
 */
export function httpAccess(
  wsUrl: string,
  fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
): (key: string | null) => Promise<number | null> {
  const url = accessUrl(wsUrl);
  return async (key) => {
    const encoded = key === null ? null : encodeAccessKey(key);
    try {
      const response = await fetcher(url, {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        headers: encoded === null ? {} : { [ACCESS_KEY_HEADER]: encoded },
        signal: AbortSignal.timeout(ACCESS_TIMEOUT_MS),
      });
      return response.status;
    } catch {
      return null;
    }
  };
}

const OPEN = 1;

const realScheduler: Scheduler = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export { sameOriginUrl } from "./server-url.ts";

/** Espera antes del reintento `attempt` (desde 0): exponencial, con jitter entre la mitad y el total. */
export function retryDelay(attempt: number, random: () => number): number {
  const full = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** attempt);
  return Math.round(full / 2 + (full / 2) * random());
}

export function createWsTransport(options: WsTransportOptions): Transport {
  const {
    url,
    open = (target: string, offered: readonly string[]) =>
      new WebSocket(target, [...offered]) as unknown as SocketLike,
    protocols = () => [],
    scheduler = realScheduler,
    random = Math.random,
    debug = () => undefined,
    probe,
    access,
    accessKey = () => null,
  } = options;
  const win = options.window === undefined ? globalThis.window : options.window;
  const doc = options.document === undefined ? globalThis.document : options.document;
  const messages = new Listeners<ServerEnvelope>();
  const statuses = new Listeners<TransportStatus>();
  let status: TransportStatus = "idle";
  let socket: SocketLike | null = null;
  /** Si se quiere estar conectado (entre `connect` y `disconnect`). */
  let wanted = false;
  let disposed = false;
  let attempt = 0;
  let retryTimer: unknown = null;
  let unavailableTimer: unknown = null;
  /** Cuenta las preguntas por HTTP: solo vale la respuesta de la última. */
  let probes = 0;
  /** Cuenta las comprobaciones de la clave antes de abrir: solo vale la de la última. */
  let checks = 0;

  const setStatus = (next: TransportStatus) => {
    if (status === next) return;
    status = next;
    statuses.emit(next);
  };

  const clearTimers = () => {
    if (retryTimer !== null) scheduler.clearTimeout(retryTimer);
    if (unavailableTimer !== null) scheduler.clearTimeout(unavailableTimer);
    retryTimer = null;
    unavailableTimer = null;
  };

  /** Suelta el socket actual sin que su cierre dispare nada. */
  const drop = (code = 1000) => {
    const current = socket;
    socket = null;
    if (!current) return;
    current.onopen = null;
    current.onclose = null;
    current.onmessage = null;
    current.onerror = null;
    try {
      current.close(code);
    } catch {
      // Ya estaba cerrado.
    }
  };

  const startUnavailableTimer = () => {
    if (unavailableTimer !== null) return;
    unavailableTimer = scheduler.setTimeout(() => {
      unavailableTimer = null;
      if (wanted && status !== "open") setStatus("unavailable");
    }, UNAVAILABLE_AFTER_MS);
  };

  const scheduleRetry = () => {
    if (retryTimer !== null) return;
    retryTimer = scheduler.setTimeout(
      () => {
        retryTimer = null;
        openNow();
      },
      retryDelay(attempt, random),
    );
    attempt++;
  };

  /** Un estado del que no se sale solo: se deja de reintentar. */
  const stop = (next: TransportStatus) => {
    wanted = false;
    clearTimers();
    setStatus(next);
  };

  /** El intento no llegó a abrir: si el servidor lo rechazó, se para; si no, se reintenta. */
  const askWhy = (ask: () => Promise<number | null>) => {
    const asked = ++probes;
    void ask().then((answer) => {
      // Mientras tanto se salió, se abrió otro intento o llegó otra respuesta: esta ya no vale.
      if (asked !== probes || disposed || !wanted || socket !== null) return;
      if (answer === 429) stop("locked");
      else if (answer === 403) stop("refused");
      else scheduleRetry();
    });
  };

  const onClose = (code: number, opened: boolean) => {
    socket = null;
    if (!wanted) {
      setStatus("idle");
      return;
    }
    const final: Partial<Record<number, TransportStatus>> = {
      [CLOSE_REPLACED]: "replaced",
      [CLOSE_UNSUPPORTED]: "incompatible",
      [CLOSE_ACCESS_DENIED]: "denied",
      [CLOSE_NO_ROOM]: "idle",
    };
    const next = final[code];
    if (next !== undefined) {
      stop(next);
      return;
    }
    if (status === "open") setStatus("reconnecting");
    startUnavailableTimer();
    if (!opened && probe) askWhy(probe);
    else scheduleRetry();
  };

  function openNow(): void {
    if (disposed || !wanted) return;
    if (retryTimer !== null) scheduler.clearTimeout(retryTimer);
    retryTimer = null;
    drop();
    if (status !== "reconnecting" && status !== "unavailable") setStatus("connecting");
    startUnavailableTimer();
    if (!access) {
      openSocket();
      return;
    }
    const asked = ++checks;
    void access(accessKey()).then((answer) => {
      // Mientras tanto se salió, se pidió otro intento o ya hay un socket: esta ya no vale.
      if (asked !== checks || disposed || !wanted || socket !== null) return;
      if (answer === 204 || answer === 404) openSocket();
      else if (answer === 401) stop("denied");
      else if (answer === 429) stop("locked");
      else if (answer === 403) stop("refused");
      else scheduleRetry();
    });
  }

  function openSocket(): void {
    let created: SocketLike;
    try {
      created = open(url, protocols());
    } catch {
      debug("[ws] could not create the socket");
      onClose(1006, false);
      return;
    }
    socket = created;
    let opened = false;
    created.onopen = () => {
      if (socket !== created) return;
      opened = true;
      attempt = 0;
      clearTimers();
      setStatus("open");
    };
    created.onclose = (event) => {
      if (socket !== created) return;
      onClose(event.code, opened);
    };
    created.onerror = () => {
      // El cierre llega después, con su código.
    };
    created.onmessage = (event) => {
      if (socket !== created || typeof event.data !== "string") return;
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch {
        debug("[ws] ignored a message that is not JSON");
        return;
      }
      const parsed = parseServerEnvelope(data);
      if (parsed.ok) messages.emit(parsed.message);
      else debug(`[ws] ignored server message: ${parsed.reason} ${parsed.type ?? "?"}`);
    };
  }

  /** Vuelta a primer plano, página restaurada o red recuperada: si no hay socket abierto, ya. */
  const wake = () => {
    if (disposed || !wanted || status === "open") return;
    // Un intento que quedó colgado mientras la página dormía también se descarta.
    attempt = 0;
    openNow();
  };
  const onVisibility = () => {
    if (doc?.visibilityState === undefined || doc.visibilityState === "visible") wake();
  };
  const onPageShow = (event: Event) => {
    if ((event as Event & { persisted?: boolean }).persisted === true) wake();
  };
  doc?.addEventListener("visibilitychange", onVisibility);
  win?.addEventListener("pageshow", onPageShow);
  win?.addEventListener("online", wake);

  return {
    get status() {
      return status;
    },
    send(message) {
      if (socket?.readyState !== OPEN || status !== "open") {
        debug(`[ws] not connected, dropped ${message.type}`);
        return;
      }
      socket.send(JSON.stringify(message));
    },
    subscribe: (listener) => messages.add(listener),
    onStatus: (listener) => statuses.add(listener),
    ...(access ? { checkAccess: (key: string) => access(key) } : {}),
    connect() {
      if (disposed) return;
      wanted = true;
      if (status === "open" || status === "connecting") return;
      if (status === "reconnecting" || status === "unavailable") {
        wake();
        return;
      }
      attempt = 0;
      openNow();
    },
    reconnect() {
      if (disposed) return;
      wanted = true;
      attempt = 0;
      clearTimers();
      if (status === "open") setStatus("reconnecting");
      else if (
        status === "replaced" ||
        status === "incompatible" ||
        status === "denied" ||
        status === "locked" ||
        status === "refused" ||
        status === "idle"
      )
        setStatus("connecting");
      openNow();
    },
    disconnect() {
      wanted = false;
      checks++;
      clearTimers();
      drop();
      setStatus("idle");
    },
    close() {
      if (disposed) return;
      wanted = false;
      checks++;
      clearTimers();
      drop(1001);
      setStatus("idle");
      disposed = true;
      doc?.removeEventListener("visibilitychange", onVisibility);
      win?.removeEventListener("pageshow", onPageShow);
      win?.removeEventListener("online", wake);
    },
  };
}
