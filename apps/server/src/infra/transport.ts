// Transporte del servidor (SPEC §8.2, ADR 0002): `ws` en producción y memoria en las pruebas. El
// núcleo de salas solo ve conexiones de texto; el handshake (origen), el `maxPayload` y el
// heartbeat son del adaptador.

/** Una conexión de un cliente, vista desde el servidor. */
export interface Link {
  send(text: string): void;
  /** Bytes encolados que el cliente todavía no recibió (control de saturación, E-17). */
  readonly bufferedAmount: number;
  close(code: number, reason: string): void;
}

/** Lo que el servidor hace con cada conexión nueva. */
export interface LinkHandlers {
  message(text: string): void;
  /** La conexión se cerró, por cualquier lado. Se llama una sola vez. */
  closed(): void;
}

export interface Transport {
  /** Empieza a aceptar conexiones. */
  start(accept: (link: Link) => LinkHandlers): Promise<void>;
  /** Deja de aceptar y cierra las conexiones abiertas con `code`. */
  stop(code: number, reason: string): Promise<void>;
}
