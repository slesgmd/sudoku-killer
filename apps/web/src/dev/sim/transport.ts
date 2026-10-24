// Transporte hacia el servidor simulado: serializa a JSON y valida con los esquemas del protocolo en
// los dos sentidos, como el WebSocket real, con una latencia configurable. `connect` abre una
// conexión nueva con el simulador y `disconnect` la cierra, como un socket.
import { parseServerEnvelope, type ServerEnvelope } from "@sudoku-killer/protocol";
import { Listeners, type Transport, type TransportStatus } from "../../transport/types.ts";
import type { SimConnection, SimServer } from "./server.ts";

export function createSimTransport(server: SimServer, latencyMs = 0): Transport {
  const messages = new Listeners<ServerEnvelope>();
  const statuses = new Listeners<TransportStatus>();
  let status: TransportStatus = "idle";
  let connection: SimConnection | null = null;
  let closed = false;
  const later = (fn: () => void) => {
    if (latencyMs > 0) setTimeout(fn, latencyMs);
    else queueMicrotask(fn);
  };
  const setStatus = (next: TransportStatus) => {
    if (status === next) return;
    status = next;
    statuses.emit(next);
  };
  const drop = () => {
    connection?.close();
    connection = null;
  };
  const open = () => {
    if (closed) return;
    drop();
    const current = server.connect((text) => {
      later(() => {
        if (connection !== current || status !== "open") return;
        const parsed = parseServerEnvelope(JSON.parse(text) as unknown);
        if (parsed.ok) messages.emit(parsed.message);
        else console.debug("[sim] ignored server message", parsed.reason, parsed.type);
      });
    });
    connection = current;
    setStatus("open");
  };
  return {
    get status() {
      return status;
    },
    send(message) {
      const current = connection;
      if (!current || status !== "open") return;
      const text = JSON.stringify(message);
      later(() => {
        if (connection === current) current.receive(text);
      });
    },
    subscribe: (listener) => messages.add(listener),
    onStatus: (listener) => statuses.add(listener),
    connect() {
      if (status !== "open") open();
    },
    reconnect() {
      open();
    },
    disconnect() {
      drop();
      setStatus("idle");
    },
    close() {
      if (closed) return;
      drop();
      setStatus("idle");
      closed = true;
    },
  };
}
