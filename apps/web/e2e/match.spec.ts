// E2E de F10 contra el servidor real, en Chromium (SPEC §9, nivel E):
// - seis pestañas juegan una partida completa, y seis clics simultáneos en la misma celda dan un
//   solo acierto y ninguna penalización (T-05.4);
// - con el reloj del cliente 10 minutos adelantado, el cronómetro coincide con el del servidor (T-07.2);
// - una desconexión y la vuelta dentro del plazo no pierden nada (T-13.5);
// - la misma ficha en otra pestaña desplaza a la primera, y «Jugar en esta pestaña» la recupera (E-08).
// El inspector de filtración revisa todo lo que reciben las páginas (fixtures.ts).
import type { Page } from "@playwright/test";
import { cell, createRoom, expect, joinRoom, test, type GameServer } from "./fixtures.ts";

function matchOf(game: GameServer, code: string) {
  const match = game.server.rooms.get(code)?.match;
  if (!match) throw new Error(`No match in ${code}`);
  return match;
}

function emptyCells(game: GameServer, code: string): number[] {
  return matchOf(game, code)
    .state.cells.map((c, i) => (c.status === "empty" ? i : -1))
    .filter((i) => i >= 0);
}

async function start(host: Page, players: readonly Page[]): Promise<void> {
  await host.getByRole("button", { name: "Iniciar partida" }).click();
  for (const page of players) {
    await expect(page.getByRole("grid", { name: "Tablero" })).toBeVisible();
    await expect(cell(page, 0)).toBeVisible();
  }
}

function at(pages: readonly Page[], index: number): Page {
  const page = pages[index];
  if (!page) throw new Error(`No page ${String(index)}`);
  return page;
}

/** Coloca un dígito como lo haría una persona: toca la celda y pulsa la tecla. */
async function place(page: Page, index: number, digit: number): Promise<void> {
  await cell(page, index).click();
  await page.keyboard.press(String(digit));
}

test("T-05.4 six tabs play a full match; six simultaneous clicks on one cell give one hit and no penalty", async ({
  player,
  game,
}) => {
  const host = await player();
  const code = await createRoom(host, "Jugador 0");
  const pages = [host];
  for (let i = 1; i < 6; i++) {
    const page = await player();
    await joinRoom(page, code, `Jugador ${String(i)}`);
    await expect(page.getByText("Esperando a que Jugador 0 inicie la partida.")).toBeVisible();
    pages.push(page);
  }
  await expect(host.getByText("6 de 6")).toBeVisible();
  await expect(
    host.getByText("Sala llena: nadie más puede entrar hasta que se libere un asiento."),
  ).toBeVisible();
  await host.getByRole("radio", { name: /Fácil/ }).check();
  await expect(at(pages, 5).getByText("Fácil", { exact: true })).toBeVisible();
  await start(host, pages);

  const solution = matchOf(game, code).solution;
  const [target, ...rest] = emptyCells(game, code);
  if (target === undefined) throw new Error("No empty cell");
  const digit = solution[target] ?? 0;
  await Promise.all(pages.map((page) => cell(page, target).click()));
  await Promise.all(pages.map((page) => page.keyboard.press(String(digit))));
  for (const page of pages)
    await expect(cell(page, target)).toHaveAttribute(
      "aria-label",
      new RegExp(`${String(digit)}, resuelta por`),
    );
  const players = [...matchOf(game, code).state.players.values()];
  expect(players).toHaveLength(6);
  expect(players.map((p) => [p.lives, p.mistakes])).toEqual(players.map(() => [3, 0]));
  expect(players.filter((p) => p.score > 0)).toHaveLength(1);

  // El resto del tablero, repartido entre las seis pestañas, que juegan a la vez.
  await Promise.all(
    pages.map(async (page, p) => {
      for (const index of rest.filter((_, i) => i % pages.length === p))
        await place(page, index, solution[index] ?? 0);
    }),
  );
  for (const page of pages)
    await expect(
      page.getByText(/La partida terminó\. El equipo completó el tablero en/),
    ).toBeVisible();
  expect(matchOf(game, code).state.result).toBe("victory");

  await host.getByRole("button", { name: "Ver resultados" }).click();
  await expect(host.getByRole("heading", { level: 1 })).toHaveText("Tablero resuelto.");
  const rows = host.getByRole("table", { name: "Ranking de la partida" }).getByRole("row");
  await expect(rows).toHaveCount(7);
  await host.getByRole("button", { name: "Volver al lobby" }).click();
  for (const page of pages)
    await expect(page.getByRole("heading", { name: "Sala de espera" })).toBeVisible();
  await expect(
    at(pages, 1).getByText("Jugador 0 volvió al lobby para preparar otra partida."),
  ).toBeVisible();
});

test("T-07.2 with the client clock 10 minutes ahead, the timer matches the server's (±1 s)", async ({
  player,
  game,
}) => {
  const page = await player();
  await page.clock.install({ time: Date.now() + 10 * 60_000 });
  const code = await createRoom(page, "Inés");
  await start(page, [page]);
  const timer = page.getByRole("timer").first();
  // Se lee justo después de un cambio del cronómetro, cuando muestra el segundo recién cumplido.
  for (let i = 0; i < 3; i++) {
    const before = await timer.textContent();
    await expect(timer).not.toHaveText(before ?? "");
    const shown = (await timer.textContent()) ?? "";
    const elapsed = (Date.now() - matchOf(game, code).state.startedAt) / 1000;
    const [minutes = 0, seconds = 0] = shown.split(":").map(Number);
    expect(
      Math.abs(minutes * 60 + seconds - elapsed),
      `${shown} vs ${String(elapsed)} s`,
    ).toBeLessThanOrEqual(1);
  }
});

test("T-13.5 disconnecting and coming back within the grace period loses nothing", async ({
  player,
  game,
}) => {
  const host = await player();
  const code = await createRoom(host, "Inés");
  const guest = await player();
  await joinRoom(guest, code, "Tomás");
  await start(host, [host, guest]);
  const solution = matchOf(game, code).solution;
  const [solved, noted, queued, wrong] = emptyCells(game, code);
  if (solved === undefined || noted === undefined || queued === undefined || wrong === undefined)
    throw new Error("Not enough empty cells");

  // Un acierto, un error (pierde una vida) y una nota personal antes del corte.
  await place(guest, solved, solution[solved] ?? 0);
  await expect(cell(guest, solved)).toHaveAttribute("aria-label", /resuelta por ti/);
  await place(guest, wrong, ((solution[wrong] ?? 0) % 9) + 1);
  await expect(guest.getByText(/no va en/).first()).toBeVisible();
  await cell(guest, noted).click();
  await guest.keyboard.press("n");
  await guest.keyboard.press("4");
  await expect(cell(guest, noted)).toHaveAttribute("aria-label", /notas personales 4/);
  const tomas = () =>
    [...matchOf(game, code).state.players.values()].find((p) => p.nickname === "Tomás");
  const before = tomas();

  // Sin red: el banner aparece y la nota se encola.
  await guest.context().setOffline(true);
  await expect(guest.getByText("Reconectando…")).toBeVisible({ timeout: 30_000 });
  // El servidor nota el silencio con su heartbeat (hasta 30 s, ADR 0002); la vuelta puede llegar
  // antes y reemplazar la conexión vieja, así que aquí no se espera a que el anfitrión lo vea.
  await cell(guest, queued).click();
  await guest.keyboard.press("6");
  await expect(guest.getByText(/\(1 en cola\)/)).toBeVisible();

  await guest.context().setOffline(false);
  await expect(guest.getByText("Reconectando…")).toBeHidden({ timeout: 30_000 });
  await expect(guest.locator(".toasts").getByText(/Conexión recuperada/)).toBeVisible();
  await expect(cell(guest, solved)).toHaveAttribute("aria-label", /resuelta por ti/);
  await expect(cell(guest, noted)).toHaveAttribute("aria-label", /notas personales 4/);
  await expect(cell(guest, queued)).toHaveAttribute("aria-label", /notas personales 6/);
  const after = tomas();
  expect(after?.connection).toBe("connected");
  expect([after?.lives, after?.score, after?.mistakes]).toEqual([
    before?.lives,
    before?.score,
    before?.mistakes,
  ]);
  expect(after?.lives).toBe(2);

  // Al recargar con la ficha guardada, la sesión se reanuda sola.
  await guest.reload();
  await expect(guest.getByRole("grid", { name: "Tablero" })).toBeVisible();
  await expect(cell(guest, noted)).toHaveAttribute("aria-label", /notas personales 4/);
  await expect(cell(guest, queued)).toHaveAttribute("aria-label", /notas personales 6/);
  expect(tomas()?.lives).toBe(2);
});

test("E-08 the same token in another tab takes over; «Jugar en esta pestaña» takes it back", async ({
  player,
  browser,
}) => {
  const context = await browser.newContext();
  try {
    const first = await player({ context });
    const code = await createRoom(first, "Inés");
    const second = await player({ context });
    await second.goto(`/#/sala/${code}`);
    await expect(second.getByRole("heading", { name: "Sala de espera" })).toBeVisible();
    const taken = first.getByRole("alertdialog", { name: "La sala está abierta en otra pestaña" });
    await expect(taken).toBeVisible();
    await taken.getByRole("button", { name: "Jugar en esta pestaña" }).click();
    await expect(taken).toBeHidden();
    await expect(
      second.getByRole("alertdialog", { name: "La sala está abierta en otra pestaña" }),
    ).toBeVisible();
    await expect(first.getByRole("heading", { name: "Sala de espera" })).toBeVisible();
    await expect(first.getByText("1 de 6")).toBeVisible();
  } finally {
    await context.close();
  }
});
