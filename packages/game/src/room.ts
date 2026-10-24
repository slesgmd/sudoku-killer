// Reglas puras de la sala fuera del registro de la partida (SPEC §2.3, §3.1 y §3.3): el código de
// sala, los asientos, el derecho de iniciar y la vista del lobby. Las usan el servidor (F9) y el
// servidor simulado del cliente (F8). El azar llega como un generador con semilla.
import type { Rng } from "@sudoku-killer/engine";
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type Connection,
  type PublicPlayer,
  type Settings,
  type Snapshot,
} from "@sudoku-killer/protocol";
import type { RoomView } from "./project.ts";
import type { PlayerId } from "./types.ts";

/** Un miembro de la sala, con lo que hace falta para las reglas del lobby. */
export interface RoomMember {
  readonly id: PlayerId;
  readonly nickname: string;
  /** 0..5; null si salió o expiró. */
  readonly seat: number | null;
  readonly joinedAt: number;
  readonly connection: Connection;
  readonly settings: Settings;
}

/** Intentos antes de rendirse: con 31⁶ códigos, solo se agotan con un generador roto. */
const MAX_CODE_ATTEMPTS = 1000;

/** Un código de sala de D2 que no choca con una sala existente (T-09.4). */
export function generateRoomCode(rng: Rng, exists: (code: string) => boolean): string {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    let code = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET.charAt(rng.int(ROOM_CODE_ALPHABET.length));
    }
    if (!exists(code)) return code;
  }
  throw new Error("Could not find a free room code");
}

/** Asiento ocupado: `connected` o `disconnected`, con cualquier rol (SPEC §2.3). */
export function holdsSeat(member: Pick<RoomMember, "connection">): boolean {
  return member.connection === "connected" || member.connection === "disconnected";
}

/** El primer asiento libre, o `null` si la sala está llena (R-08). */
export function freeSeat(
  members: Iterable<Pick<RoomMember, "seat" | "connection">>,
  maxSeats: number,
): number | null {
  const taken = new Set<number>();
  for (const member of members) {
    if (member.seat !== null && holdsSeat(member)) taken.add(member.seat);
  }
  for (let seat = 0; seat < maxSeats; seat++) if (!taken.has(seat)) return seat;
  return null;
}

/** Si `preferred` sigue libre, ese; si no, el primero libre (SPEC §3.2, vuelta con ficha). */
export function seatFor(
  members: Iterable<Pick<RoomMember, "seat" | "connection">>,
  maxSeats: number,
  preferred: number | null,
): number | null {
  const list = [...members];
  if (preferred !== null && preferred < maxSeats) {
    const taken = list.some((m) => m.seat === preferred && holdsSeat(m));
    if (!taken) return preferred;
  }
  return freeSeat(list, maxSeats);
}

/**
 * A quién pasa el derecho de iniciar (R-11): el de menor `joinedAt` entre los que tienen asiento,
 * con el `id` como desempate para que sea determinista. `null` si no queda nadie.
 */
export function nextStarter(
  members: Iterable<Pick<RoomMember, "id" | "joinedAt" | "seat" | "connection">>,
): PlayerId | null {
  let best: Pick<RoomMember, "id" | "joinedAt"> | null = null;
  for (const member of members) {
    if (member.seat === null || !holdsSeat(member)) continue;
    if (
      best === null ||
      member.joinedAt < best.joinedAt ||
      (member.joinedAt === best.joinedAt && member.id < best.id)
    ) {
      best = member;
    }
  }
  return best?.id ?? null;
}

/** Un miembro fuera de una partida: sin rol, vidas ni puntos. */
export function lobbyPlayer(member: RoomMember): PublicPlayer {
  return {
    id: member.id,
    nickname: member.nickname,
    seat: member.seat,
    joinedAt: member.joinedAt,
    connection: member.connection,
    role: null,
    lives: 0,
    score: 0,
    mistakes: 0,
  };
}

/** Snapshot sin partida (lobby, SPEC §4.5): la sala y los ajustes de quien lo recibe. */
export function lobbySnapshot(room: RoomView, you: RoomMember, serverNow: number): Snapshot {
  return {
    serverNow,
    atSeq: null,
    room: { ...room, players: [...room.players] },
    match: null,
    you: { playerId: you.id, settings: you.settings, personalNotes: [] },
  };
}
