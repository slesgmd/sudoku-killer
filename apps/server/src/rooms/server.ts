// Servidor de salas: recibe las conexiones del `Transport`, valida cada mensaje con los esquemas del
// protocolo (Zod), aplica los límites de velocidad (§4.8) y la saturación (E-17), y despacha a la
// cola de cada sala. Un error al cliente nunca lleva trazas ni detalles internos.
import { generateRoomCode, type GameMode } from "@sudoku-killer/game";
import type { Rng } from "@sudoku-killer/engine";
import {
  CLOSE_NO_ROOM,
  CLOSE_UNSUPPORTED,
  isValidNickname,
  parseClientEnvelope,
  type ErrorCode,
  type ServerEnvelope,
} from "@sudoku-killer/protocol";
import type { Clock } from "../infra/clock.ts";
import type { IdGenerator } from "../infra/random.ts";
import type { Link, LinkHandlers, Transport } from "../infra/transport.ts";
import type { Logger } from "../log/logger.ts";
import type { EventSink } from "../match/sink.ts";
import type { PuzzleCatalog } from "../puzzles/catalog.ts";
import {
  CLOSE_SLOW_BYTES,
  CLOSE_TRY_AGAIN_LATER,
  COMMAND_BUCKET,
  DROP_PRESENCE_BYTES,
  NO_ROOM_MS,
  PING_BUCKET,
  PRESENCE_BUCKET,
} from "./limits.ts";
import { Room, type Session } from "./room.ts";
import { MemoryRoomStore, type RoomStore } from "./store.ts";
import { TokenBucket } from "./token-bucket.ts";

export interface RoomServerOptions {
  readonly transport: Transport;
  readonly clock: Clock;
  readonly random: Rng;
  readonly ids: IdGenerator;
  readonly catalog: PuzzleCatalog;
  readonly sink: EventSink;
  readonly logger: Logger;
  readonly mode: GameMode;
  readonly store?: RoomStore;
}

/** `clientMsgId` de un mensaje que no pasó la validación, si tiene la forma correcta. */
function idOf(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null || !("id" in input)) return undefined;
  const id = input.id;
  return typeof id === "string" && id.length >= 1 && id.length <= 64 ? id : undefined;
}

function typeOf(input: unknown): unknown {
  return typeof input === "object" && input !== null && "type" in input ? input.type : undefined;
}

class Connection implements Session {
  readonly id: number;
  room: Room | null = null;
  playerId: string | null = null;
  closed = false;
  readonly commands: TokenBucket;
  readonly presence: TokenBucket;
  readonly pings: TokenBucket;
  private readonly link: Link;
  private readonly clock: Clock;
  private cancelIdle: (() => void) | null = null;

  constructor(id: number, link: Link, clock: Clock) {
    this.id = id;
    this.link = link;
    this.clock = clock;
    this.commands = new TokenBucket(COMMAND_BUCKET, clock);
    this.presence = new TokenBucket(PRESENCE_BUCKET, clock);
    this.pings = new TokenBucket(PING_BUCKET, clock);
    this.startIdle();
  }

  send(envelope: ServerEnvelope, { droppable = false } = {}): void {
    if (this.closed) return;
    // Saturación (E-17): primero se descarta la presencia; después se cierra y el cliente se
    // reconecta con un snapshot. Los mensajes del registro nunca se descartan.
    const buffered = this.link.bufferedAmount;
    if (buffered > CLOSE_SLOW_BYTES) {
      this.close(CLOSE_TRY_AGAIN_LATER, "slow consumer");
      return;
    }
    if (droppable && buffered > DROP_PRESENCE_BYTES) return;
    this.link.send(JSON.stringify(envelope));
  }

  error(replyTo: string | undefined, code: ErrorCode): void {
    this.send({
      v: 1,
      type: "error",
      payload: { code },
      ...(replyTo === undefined ? {} : { replyTo }),
    });
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.link.close(code, reason);
  }

  bind(room: Room, playerId: string): void {
    this.room = room;
    this.playerId = playerId;
    this.cancelIdle?.();
    this.cancelIdle = null;
  }

  unbind(): void {
    this.room = null;
    this.playerId = null;
    this.startIdle();
  }

  /** Una conexión sin sala se cierra a los 30 s (ADR 0002). */
  private startIdle(): void {
    this.cancelIdle?.();
    this.cancelIdle = this.clock.setTimeout(() => {
      if (this.room === null) this.close(CLOSE_NO_ROOM, "no room");
    }, NO_ROOM_MS);
  }

  dispose(): void {
    this.closed = true;
    this.cancelIdle?.();
    this.cancelIdle = null;
  }
}

export class RoomServer {
  readonly rooms: RoomStore;
  private readonly options: RoomServerOptions;
  private nextConnection = 1;

  constructor(options: RoomServerOptions) {
    this.options = options;
    this.rooms = options.store ?? new MemoryRoomStore();
  }

  start(): Promise<void> {
    return this.options.transport.start((link) => this.accept(link));
  }

  /** Se resuelve cuando todas las salas terminaron lo que tenían en cola (para las pruebas). */
  async idle(): Promise<void> {
    for (const room of [...this.rooms.values()]) await room.idle();
  }

  private accept(link: Link): LinkHandlers {
    const connection = new Connection(this.nextConnection++, link, this.options.clock);
    return {
      message: (text) => {
        this.receive(connection, text);
      },
      closed: () => {
        connection.dispose();
        const room = connection.room;
        if (room) {
          room.enqueue(() => {
            room.disconnect(connection);
          });
        }
      },
    };
  }

  private newRoom(): Room {
    const { clock, random, ids, catalog, sink, logger, mode } = this.options;
    const code = generateRoomCode(random, (candidate) => this.rooms.has(candidate));
    const room = new Room(code, {
      clock,
      random,
      ids,
      catalog,
      sink,
      logger,
      mode,
      onDeleted: (deleted) => {
        if (this.rooms.get(deleted.code) === deleted) this.rooms.delete(deleted.code);
      },
    });
    this.rooms.add(room);
    logger.info("room created", { room: code });
    return room;
  }

  private receive(connection: Connection, text: string): void {
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      connection.error(undefined, "bad_request");
      return;
    }
    // Límite de velocidad antes de validar (§4.8): la presencia y los pings que sobran se descartan.
    const type = typeOf(input);
    if (type === "presence.select") {
      if (!connection.presence.take()) return;
    } else if (type === "sys.ping") {
      if (!connection.pings.take()) return;
    } else if (!connection.commands.take()) {
      connection.error(idOf(input), "rate_limited");
      return;
    }

    const parsed = parseClientEnvelope(input);
    if (!parsed.ok) {
      connection.error(idOf(input), parsed.code);
      if (parsed.code === "protocol.unsupported") {
        connection.close(CLOSE_UNSUPPORTED, "protocol.unsupported");
      }
      return;
    }
    const message = parsed.message;
    const onError = () => {
      connection.error(message.id, "server.unavailable");
    };

    switch (message.type) {
      case "sys.ping":
        connection.send({
          v: 1,
          type: "sys.pong",
          payload: { t0: message.payload.t0, serverNow: this.options.clock.now() },
        });
        return;
      case "room.create": {
        if (connection.room) {
          connection.error(message.id, "room.wrong_state");
          return;
        }
        if (!isValidNickname(message.payload.nickname)) {
          connection.error(message.id, "nickname.invalid");
          return;
        }
        const room = this.newRoom();
        room.enqueue(() => {
          room.join(connection, message);
        }, onError);
        return;
      }
      case "room.join": {
        if (connection.room) {
          connection.error(message.id, "room.wrong_state");
          return;
        }
        const room = this.rooms.get(message.payload.code.toUpperCase());
        if (!room || room.deleted) {
          connection.error(message.id, "room.not_found");
          return;
        }
        room.enqueue(() => {
          if (room.deleted) connection.error(message.id, "room.not_found");
          else room.join(connection, message);
        }, onError);
        return;
      }
      default: {
        const room = connection.room;
        if (!room) {
          connection.error(message.id, "room.not_found");
          return;
        }
        room.enqueue(() => room.command(connection, message), onError);
      }
    }
  }
}
