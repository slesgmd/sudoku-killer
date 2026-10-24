// Transporte en memoria para las pruebas (SPEC §8.2): cada cliente es un `MemoryClient` que envía
// texto y guarda lo que recibe. Simula el `bufferedAmount` (E-17) y deja mirar cada mensaje
// saliente antes de entregarlo (inspector de filtración, §8.3).
import type { Link, LinkHandlers, Transport } from "./transport.ts";

export interface MemoryClient {
  readonly id: number;
  /** Mensajes recibidos del servidor, como texto. */
  readonly received: string[];
  /** Código y motivo del cierre, si la conexión se cerró. */
  readonly closed: { readonly code: number; readonly reason: string } | null;
  send(text: string): void;
  /** El cliente cierra la conexión (o se cae). */
  disconnect(): void;
  /** Bytes que el cliente "no leyó" (E-17). */
  bufferedAmount: number;
}

export type OutgoingHook = (clientId: number, text: string) => void;

export class MemoryTransport implements Transport {
  private accept: ((link: Link) => LinkHandlers) | null = null;
  private nextId = 1;
  private readonly open = new Map<number, { client: Client; handlers: LinkHandlers }>();
  private readonly onOutgoing: OutgoingHook | undefined;

  constructor(onOutgoing?: OutgoingHook) {
    this.onOutgoing = onOutgoing;
  }

  start(accept: (link: Link) => LinkHandlers): Promise<void> {
    this.accept = accept;
    return Promise.resolve();
  }

  stop(code: number, reason: string): Promise<void> {
    for (const { client } of [...this.open.values()]) client.serverClose(code, reason);
    this.accept = null;
    return Promise.resolve();
  }

  /** Abre una conexión nueva. */
  connect(): MemoryClient {
    const accept = this.accept;
    if (!accept) throw new Error("The transport is not started");
    const id = this.nextId++;
    const client = new Client(id, this.onOutgoing, () => {
      const entry = this.open.get(id);
      this.open.delete(id);
      entry?.handlers.closed();
    });
    const handlers = accept(client.link);
    this.open.set(id, { client, handlers });
    client.deliverTo = (text) => {
      if (this.open.has(id)) handlers.message(text);
    };
    return client;
  }
}

class Client implements MemoryClient {
  readonly id: number;
  readonly received: string[] = [];
  closed: { code: number; reason: string } | null = null;
  bufferedAmount = 0;
  deliverTo: (text: string) => void = () => undefined;
  readonly link: Link;
  private readonly onClosed: () => void;

  constructor(id: number, onOutgoing: OutgoingHook | undefined, onClosed: () => void) {
    this.id = id;
    this.onClosed = onClosed;
    this.link = {
      send: (text) => {
        if (this.closed) return;
        onOutgoing?.(id, text);
        this.received.push(text);
      },
      bufferedAmount: 0,
      close: (code, reason) => {
        this.serverClose(code, reason);
      },
    };
    Object.defineProperty(this.link, "bufferedAmount", { get: () => this.bufferedAmount });
  }

  send(text: string): void {
    if (this.closed) throw new Error(`Client ${String(this.id)} is closed`);
    this.deliverTo(text);
  }

  disconnect(): void {
    if (this.closed) return;
    this.closed = { code: 1006, reason: "" };
    this.onClosed();
  }

  serverClose(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = { code, reason };
    this.onClosed();
  }
}
