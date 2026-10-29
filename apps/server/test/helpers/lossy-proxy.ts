// Proxies TCP de prueba que se portan como el de Render delante del servidor. Las respuestas
// HTTP sin upgrade (`POST /access`, `GET /ws`) pasan tal cual; lo que cambia es el WebSocket:
// - `early`: pierde lo que el servidor envía detrás del 101 antes de que el cliente envíe algo (lo
//   que se vio en el primer despliegue, T-39.11).
// - `close`: pierde el cierre del servidor, el marco de cierre y el fin de la conexión; los demás
//   marcos pasan. El cliente ve la conexión abierta y muda hasta que el proxy la corta, a los
//   `idleMs`, sin marco de cierre (un 1006). Es lo que se midió en producción con el 4003, enviando
//   o no un primer mensaje (T-39.16).
// - `pass`: no pierde nada.
// El modo se puede cambiar en caliente y vale para las conexiones nuevas.
import { createConnection, createServer, type Server, type Socket } from "node:net";

export type LossMode = "pass" | "early" | "close";

export interface LossyProxy {
  readonly port: number;
  mode: LossMode;
  close(): Promise<void>;
}

/** Lo que tarda el proxy en cortar una conexión cuyo servidor ya cerró (en producción, 20–25 s). */
export const PROXY_IDLE_MS = 20_000;

/** El largo del primer marco de WebSocket de `buffer` y su código, o `null` si no llegó entero. */
function frameAt(buffer: Buffer): { readonly length: number; readonly opcode: number } | null {
  if (buffer.length < 2) return null;
  const first = buffer[0] ?? 0;
  const second = buffer[1] ?? 0;
  let size = second & 0x7f;
  let offset = 2;
  if (size === 126) {
    if (buffer.length < 4) return null;
    size = buffer.readUInt16BE(2);
    offset = 4;
  } else if (size === 127) {
    if (buffer.length < 10) return null;
    size = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  if ((second & 0x80) !== 0) offset += 4;
  if (buffer.length < offset + size) return null;
  return { length: offset + size, opcode: first & 0x0f };
}

const CLOSE_OPCODE = 0x8;

export async function lossyProxy(
  target: number,
  {
    mode = "pass",
    port = 0,
    idleMs = PROXY_IDLE_MS,
  }: { mode?: LossMode; port?: number; idleMs?: number } = {},
): Promise<LossyProxy> {
  const sockets = new Set<Socket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const state = { mode };
  const server: Server = createServer((client) => {
    const connectionMode = state.mode;
    const upstream = createConnection({ host: "127.0.0.1", port: target });
    sockets.add(client);
    sockets.add(upstream);
    let request = Buffer.alloc(0);
    let requestDone = false;
    let clientSpoke = false;
    let head = Buffer.alloc(0);
    /** `null` hasta leer la primera respuesta; después, si fue un 101. */
    let upgraded: boolean | null = null;
    let frames = Buffer.alloc(0);
    let lingering = false;
    const finish = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on("data", (chunk: Buffer) => {
      if (requestDone) {
        clientSpoke = true;
      } else {
        request = Buffer.concat([request, chunk]);
        const end = request.indexOf("\r\n\r\n");
        if (end >= 0) {
          requestDone = true;
          clientSpoke = end + 4 < request.length;
        }
      }
      if (!upstream.destroyed) upstream.write(chunk);
    });
    /** Lo que sigue al 101, según el modo. */
    const forwardFrames = (chunk: Buffer) => {
      if (connectionMode === "early") {
        if (clientSpoke) client.write(chunk);
        return;
      }
      if (connectionMode === "pass") {
        client.write(chunk);
        return;
      }
      frames = Buffer.concat([frames, chunk]);
      for (let frame = frameAt(frames); frame !== null; frame = frameAt(frames)) {
        if (frame.opcode !== CLOSE_OPCODE) client.write(frames.subarray(0, frame.length));
        frames = frames.subarray(frame.length);
      }
    };
    upstream.on("data", (chunk: Buffer) => {
      if (upgraded === false) {
        client.write(chunk);
        return;
      }
      if (upgraded === true) {
        forwardFrames(chunk);
        return;
      }
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end < 0) return;
      upgraded = head.subarray(0, 12).toString("latin1") === "HTTP/1.1 101";
      client.write(head.subarray(0, end + 4));
      const rest = head.subarray(end + 4);
      if (rest.length === 0) return;
      if (upgraded) forwardFrames(rest);
      else client.write(rest);
    });
    const upstreamGone = () => {
      if (upgraded === true && connectionMode === "close") {
        // El cliente no se entera: la conexión sigue abierta hasta que el proxy la corta.
        if (lingering) return;
        lingering = true;
        const timer = setTimeout(() => {
          timers.delete(timer);
          client.destroy();
        }, idleMs);
        timers.add(timer);
        return;
      }
      finish();
    };
    client.on("close", finish);
    client.on("error", finish);
    upstream.on("close", upstreamGone);
    upstream.on("error", upstreamGone);
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  return {
    port: typeof address === "object" && address ? address.port : port,
    get mode() {
      return state.mode;
    },
    set mode(next: LossMode) {
      state.mode = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const timer of timers) clearTimeout(timer);
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          resolve();
        });
      }),
  };
}
