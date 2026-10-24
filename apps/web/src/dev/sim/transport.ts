// Transporte hacia el servidor simulado: serializa a JSON y valida con los esquemas del protocolo en
// los dos sentidos, como hará el WebSocket de F10, con una latencia configurable.
import { parseServerEnvelope, type ServerEnvelope } from "@sudoku-killer/protocol";
import { Listeners, type Transport, type TransportStatus } from "../../transport/types.ts";
import type { SimServer } from "./server.ts";

export function createSimTransport(server: SimServer, latencyMs = 0): Transport {
  const messages = new Listeners<ServerEnvelope>();
  const statuses = new Listeners<TransportStatus>();
  let status: TransportStatus = "open";
  const later = (fn: () => void) => {
    if (latencyMs > 0) setTimeout(fn, latencyMs);
    else queueMicrotask(fn);
  };
  const connection = server.connect((text) => {
    later(() => {
      if (status !== "open") return;
      const parsed = parseServerEnvelope(JSON.parse(text) as unknown);
      if (parsed.ok) messages.emit(parsed.message);
      else console.debug("[sim] ignored server message", parsed);
    });
  });
  return {
    get status() {
      return status;
    },
    send(message) {
      const text = JSON.stringify(message);
      later(() => {
        connection.receive(text);
      });
    },
    subscribe: (listener) => messages.add(listener),
    onStatus: (listener) => statuses.add(listener),
    close() {
      if (status === "closed") return;
      status = "closed";
      connection.close();
      statuses.emit(status);
    },
  };
}
