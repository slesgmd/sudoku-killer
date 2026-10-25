// E2E de F10 contra el servidor real, en Chromium (SPEC §9, nivel E):
// - seis pestañas juegan una partida completa, y seis clics simultáneos en la misma celda dan un
//   solo acierto y ninguna penalización (T-05.4);
// - con el reloj del cliente 10 minutos adelantado, el cronómetro coincide con el del servidor (T-07.2);
// - un corte real (la página se cierra con su WebSocket) y la vuelta dentro del plazo no pierden
//   nada (T-13.5);
// - la misma ficha en otra pestaña desplaza a la primera, y «Jugar en esta pestaña» la recupera (E-08).
// El inspector de filtración revisa todo lo que reciben las páginas (fixtures.ts).
import type { Page } from "@playwright/test";
import {
  cell,
  connections,
  createRoom,
  expect,
  joinRoom,
  record,
  test,
  type GameServer,
} from "./fixtures.ts";

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

/**
 * Verificación negativa: con `SK_E2E_FORGET_TOKEN=1` se borra la ficha antes de volver, y T-13.5
 * tiene que fallar (sin ficha, el enlace de la sala abre Entrar en lugar de la partida).
 */
const FORGET_TOKEN = process.env["SK_E2E_FORGET_TOKEN"] === "1";

test("T-13.5 a real disconnection (the page closes) and coming back within the grace period loses nothing", async ({
  player,
  game,
  browser,
}) => {
  const host = await player();
  const seen = record(host);
  const code = await createRoom(host, "Inés");
  // La persona que se corta tiene su propio contexto: su localStorage (y su ficha) sobrevive al
  // cierre de la página, como en un navegador real.
  const context = await browser.newContext();
  try {
    const guest = await player({ context });
    await joinRoom(guest, code, "Tomás");
    await start(host, [host, guest]);
    const solution = matchOf(game, code).solution;
    const [solved, noted, wrong] = emptyCells(game, code);
    if (solved === undefined || noted === undefined || wrong === undefined)
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
    if (!before) throw new Error("No Tomás");
    expect(before.lives).toBe(2);

    // El corte: la página se cierra y su WebSocket con ella.
    await guest.close();
    await expect.poll(() => connections(seen, before.id)).toEqual(["disconnected"]);
    expect(tomas()?.connection).toBe("disconnected");

    // La vuelta, dentro del plazo, en otra página del mismo navegador.
    const back = await player({ context });
    await back.goto("/#/");
    if (FORGET_TOKEN)
      await back.evaluate(() => {
        for (const key of Object.keys(localStorage))
          if (key.startsWith("sk:token:")) localStorage.removeItem(key);
      });
    await back.goto(`/#/sala/${code}`);
    await expect(back.getByRole("grid", { name: "Tablero" })).toBeVisible();
    await expect.poll(() => connections(seen, before.id)).toEqual(["disconnected", "connected"]);
    await expect(cell(back, solved)).toHaveAttribute("aria-label", /resuelta por ti/);
    await expect(cell(back, noted)).toHaveAttribute("aria-label", /notas personales 4/);
    const after = tomas();
    expect(after?.id).toBe(before.id);
    expect(after?.connection).toBe("connected");
    expect([after?.seat, after?.lives, after?.score, after?.mistakes]).toEqual([
      before.seat,
      before.lives,
      before.score,
      before.mistakes,
    ]);
    expect([...(after?.personalNotes ?? [])]).toEqual([...before.personalNotes]);
    await expect(back.getByRole("button", { name: /^Número 5,/ })).toBeVisible();
  } finally {
    await context.close();
  }
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
