// Interfaz `Transport` del cliente (PLAN §3.5, SPEC §8.2): el cliente habla el protocolo v1 sin
// saber si del otro lado está el servidor real (F10) o el simulado de desarrollo (F8).
import type { ClientEnvelope, ServerEnvelope } from "@sudoku-killer/protocol";

export type TransportStatus = "connecting" | "open" | "closed" | "unavailable";

export interface Transport {
  /** Envía un mensaje ya armado. */
  send(message: ClientEnvelope): void;
  /** Recibe los mensajes del servidor ya validados. Devuelve la función para dejar de escuchar. */
  subscribe(listener: (message: ServerEnvelope) => void): () => void;
  onStatus(listener: (status: TransportStatus) => void): () => void;
  readonly status: TransportStatus;
  close(): void;
}

/** Ayuda para las implementaciones: listas de oyentes. */
export class Listeners<T> {
  private readonly listeners = new Set<(value: T) => void>();

  add(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) listener(value);
  }
}
