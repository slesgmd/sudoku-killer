// `RoomStore` (SPEC §8.2, ADR 0003): las salas vivas, en memoria en la v1. La interfaz deja la puerta
// abierta a otro almacén si se escala a varias instancias.
import type { Room } from "./room.ts";

export interface RoomStore {
  get(code: string): Room | undefined;
  has(code: string): boolean;
  add(room: Room): void;
  delete(code: string): void;
  values(): Iterable<Room>;
}

export class MemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, Room>();

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  has(code: string): boolean {
    return this.rooms.has(code);
  }

  add(room: Room): void {
    this.rooms.set(room.code, room);
  }

  delete(code: string): void {
    this.rooms.delete(code);
  }

  values(): Iterable<Room> {
    return this.rooms.values();
  }
}
