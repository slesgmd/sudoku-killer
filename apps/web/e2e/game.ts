// Ayudas de las E2E para jugar contra el servidor real: el estado de la partida en el servidor y
// las acciones de una persona en la página.
import type { Page } from "@playwright/test";
import type { Room } from "../../server/src/rooms/room.ts";
import { cell, expect, type GameServer } from "./fixtures.ts";

export function matchOf(game: GameServer, code: string): NonNullable<Room["match"]> {
  const match = game.server.rooms.get(code)?.match;
  if (!match) throw new Error(`No match in ${code}`);
  return match;
}

export function emptyCells(game: GameServer, code: string): number[] {
  return matchOf(game, code)
    .state.cells.map((c, i) => (c.status === "empty" ? i : -1))
    .filter((i) => i >= 0);
}

/** El jugador del servidor con ese apodo. */
export function playerOf(game: GameServer, code: string, nickname: string) {
  const player = [...matchOf(game, code).state.players.values()].find(
    (p) => p.nickname === nickname,
  );
  if (!player) throw new Error(`No ${nickname} in ${code}`);
  return player;
}

export async function start(host: Page, players: readonly Page[]): Promise<void> {
  await host.getByRole("button", { name: "Iniciar partida" }).click();
  for (const page of players) {
    await expect(page.getByRole("grid", { name: "Tablero" })).toBeVisible();
    await expect(cell(page, 0)).toBeVisible();
  }
}

export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`No item ${String(index)}`);
  return item;
}

/** Coloca un dígito como lo haría una persona: toca la celda y pulsa la tecla. */
export async function place(page: Page, index: number, digit: number): Promise<void> {
  await cell(page, index).click();
  await page.keyboard.press(String(digit));
}

/** Un dígito que no va en la celda (para provocar un error). */
export function wrongDigit(solution: readonly number[], index: number): number {
  return ((solution[index] ?? 0) % 9) + 1;
}
