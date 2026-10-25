// Interfaz `Transport` del cliente (PLAN §3.5, SPEC §8.2): el cliente habla el protocolo v1 sin
// saber si del otro lado está el servidor real (F10) o el simulado de desarrollo (F8).
import type { ClientEnvelope, ServerEnvelope } from "@sudoku-killer/protocol";

/**
 * - `idle`: sin conexión y sin intentar (antes de entrar a una sala o después de salir).
 * - `connecting`: primer intento de conexión.
 * - `open`: conectado.
 * - `reconnecting`: la conexión cayó y se reintenta (ADR 0002).
 * - `unavailable`: no hubo conexión en un tiempo; se sigue reintentando.
 * - `replaced`: otra pestaña tomó la sesión (4001, E-08); no se reconecta solo.
 * - `incompatible`: el servidor usa otra versión del protocolo (4000, E-19); no se reconecta.
 * - `denied`: falta la clave de acceso del grupo o no vale (4003, R-39); no se reconecta solo.
 */
export type TransportStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "unavailable"
  | "replaced"
  | "incompatible"
  | "denied";

export interface Transport {
  /** Envía un mensaje ya armado. Sin conexión abierta, se descarta: el cliente decide qué reenviar. */
  send(message: ClientEnvelope): void;
  /** Recibe los mensajes del servidor ya validados. Devuelve la función para dejar de escuchar. */
  subscribe(listener: (message: ServerEnvelope) => void): () => void;
  onStatus(listener: (status: TransportStatus) => void): () => void;
  readonly status: TransportStatus;
  /** Abre la conexión si no está abierta ni intentándose. */
  connect(): void;
  /** Descarta la conexión actual y abre otra ya, sin espera («Jugar en esta pestaña», pong vencido). */
  reconnect(): void;
  /** Cierra la conexión y deja de reintentar (`idle`). */
  disconnect(): void;
  /** Libera el transporte para siempre. */
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
