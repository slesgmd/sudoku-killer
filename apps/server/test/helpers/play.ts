// Ayudas para armar salas y jugadas en las pruebas de integración.
import type { TestClient, TestServer } from "./server.ts";
import { welcomeOf } from "./server.ts";

export interface Table {
  readonly code: string;
  readonly clients: TestClient[];
}

/** Una sala creada por el primer apodo, con los demás adentro. */
export async function table(h: TestServer, nicknames: readonly string[]): Promise<Table> {
  const [first, ...rest] = nicknames;
  if (first === undefined) throw new Error("No players");
  const creator = h.client();
  const code = welcomeOf(await creator.create(first)).payload.snapshot.room.code;
  const clients = [creator];
  for (const nickname of rest) {
    // Cada uno entra 10 ms después del anterior: la antigüedad decide el traspaso (R-11).
    await h.advance(10);
    const client = h.client();
    welcomeOf(await client.join(code, nickname));
    clients.push(client);
  }
  return { code, clients };
}

/** Una sala con la partida empezada. */
export async function started(h: TestServer, nicknames: readonly string[]): Promise<Table> {
  const t = await table(h, nicknames);
  const [starter] = t.clients;
  if (!starter) throw new Error("No starter");
  await starter.send("match.start", {});
  return t;
}

/** Las celdas vacías de la partida de la sala. */
export function emptyCells(h: TestServer, code: string): number[] {
  const match = h.room(code).match;
  if (!match) throw new Error("No match");
  return match.state.cells.flatMap((cell, i) => (cell.status === "empty" ? [i] : []));
}

export function firstEmpty(h: TestServer, code: string): number {
  const cell = emptyCells(h, code)[0];
  if (cell === undefined) throw new Error("No empty cell");
  return cell;
}

export function answer(h: TestServer, code: string, cell: number): number {
  const digit = h.solutionOf(code)[cell];
  if (digit === undefined) throw new Error(`No cell ${String(cell)}`);
  return digit;
}

export function wrong(h: TestServer, code: string, cell: number, offset = 0): number {
  return ((answer(h, code, cell) + offset) % 9) + 1;
}

/** El jugador comete errores hasta quedar sin vidas (pasa a espectador). */
export async function exhaust(h: TestServer, code: string, client: TestClient): Promise<void> {
  const cell = firstEmpty(h, code);
  for (let i = 0; i < 3; i++) {
    await client.send("cell.place", { cell, digit: wrong(h, code, cell, i) });
  }
}

/**
 * Resuelve todas las celdas vacías menos las de `keep`, con el cliente dado. Entre jugada y jugada
 * avanza el reloj 60 ms, para no pasar el límite de 20 comandos por segundo (§4.8).
 */
export async function solveAllBut(
  h: TestServer,
  code: string,
  client: TestClient,
  keep: readonly number[] = [],
): Promise<void> {
  for (const cell of emptyCells(h, code)) {
    if (keep.includes(cell)) continue;
    client.post("cell.place", { cell, digit: answer(h, code, cell) });
    await h.advance(60);
  }
}

/** Estado de un jugador en la partida viva de la sala. */
export function playerIn(h: TestServer, code: string, playerId: string | null) {
  if (playerId === null) throw new Error("No player id");
  const player = h.room(code).match?.state.players.get(playerId);
  if (!player) throw new Error(`No player ${playerId}`);
  return player;
}
