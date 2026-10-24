// Transporte de producción hasta F10: no hay servidor real todavía, así que no envía nada.
import { Listeners, type Transport } from "./types.ts";

export function createUnavailableTransport(): Transport {
  const messages = new Listeners<never>();
  const statuses = new Listeners<"unavailable">();
  return {
    status: "unavailable",
    send() {
      // Sin servidor: el mensaje se descarta.
    },
    subscribe: (listener) => messages.add(listener),
    onStatus: (listener) => statuses.add(listener),
    close() {
      // Nada que cerrar.
    },
  };
}
