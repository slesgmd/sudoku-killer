// E2E sobre casos límite de la SPEC (§7) que tienen su prueba de integración en el servidor,
// pero no en el cliente: aquí se comprueba lo que hace la página (reconexión, bandeja de
// pendientes, pantallas y avisos) contra el servidor real.
// - derrota con espectadores y su causa en Resultados y al recargar (E-10, T-01.2, T-01.6, T-01.7);
// - reinicio del servidor a mitad de partida (E-15, T-32.2);
// - fallo de la base de datos de más de 10 s (E-16, T-32.3);
// - vuelta con ficha a una sala llena y, con un asiento libre, con sus datos (E-02, E-23, T-26.4).
import type { Page } from "@playwright/test";
import { cell, createRoom, expect, joinRoom, record, test } from "./fixtures.ts";
import { emptyCells, matchOf, place, playerOf, start, wrongDigit } from "./game.ts";

/** Sale de la sala desde la cabecera de la partida (R-26). */
async function leave(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  await page.getByRole("button", { name: "Salir de la sala" }).click();
}

test("E-10 T-01.6 T-01.7 the last active player loses their last life with a spectator left: defeat, its cause in Results and after a reload", async ({
  player,
  game,
}) => {
  const host = await player();
  const seen = record(host);
  const code = await createRoom(host, "Inés");
  const guest = await player();
  await joinRoom(guest, code, "Tomás");
  await start(host, [host, guest]);
  const solution = matchOf(game, code).solution;
  const wrong = emptyCells(game, code).slice(0, 6);

  // Tomás pierde sus 3 vidas y queda como espectador; la partida sigue.
  for (const [i, index] of wrong.slice(0, 3).entries()) {
    await place(guest, index, wrongDigit(solution, index));
    await expect.poll(() => playerOf(game, code, "Tomás").lives).toBe(2 - i);
  }
  expect(playerOf(game, code, "Tomás").role).toBe("spectator");
  expect(matchOf(game, code).state.result).toBeNull();

  // Inés, la última activa, pierde la última: derrota inmediata (E-10).
  for (const index of wrong.slice(3)) await place(host, index, wrongDigit(solution, index));
  for (const page of [host, guest])
    await expect(page.getByText("La partida terminó. Se acabaron las vidas.")).toBeVisible();
  expect(matchOf(game, code).state.result).toBe("defeat");
  const ended = seen.find((m) => m.type === "match.ended");
  expect(ended?.type === "match.ended" && ended.payload.defeatCause).toBe("lives");

  await guest.getByRole("button", { name: "Ver resultados" }).click();
  await expect(guest.getByRole("heading", { level: 1 })).toHaveText("Se acabaron las vidas.");
  await expect(
    guest.getByText("Todos los jugadores perdieron sus 3 vidas antes de completar el tablero."),
  ).toBeVisible();
  await expect(guest.getByText("Esperando a que Inés vuelva al lobby.")).toBeVisible();

  // Al recargar, la sala terminada abre Resultados (decisión 3) y la causa sale del snapshot (T-01.7).
  await host.reload();
  await expect(host.getByRole("heading", { level: 1 })).toHaveText("Se acabaron las vidas.");
  await host.getByRole("button", { name: "Volver al lobby" }).click();
  for (const page of [host, guest])
    await expect(page.getByRole("heading", { name: "Sala de espera" })).toBeVisible();
});

test("E-15 T-32.2 the server restarts mid-match: the pages reconnect on their own and nothing is lost", async ({
  player,
  game,
}) => {
  const host = await player();
  const code = await createRoom(host, "Inés");
  const guest = await player();
  await joinRoom(guest, code, "Tomás");
  await start(host, [host, guest]);
  const solution = matchOf(game, code).solution;
  const [solved, wrong, noted, after] = emptyCells(game, code);
  if (after === undefined || solved === undefined || wrong === undefined || noted === undefined)
    throw new Error("Not enough empty cells");

  await place(guest, solved, solution[solved] ?? 0);
  await place(guest, wrong, wrongDigit(solution, wrong));
  await cell(guest, noted).click();
  await guest.keyboard.press("n");
  await guest.keyboard.press("4");
  await expect(cell(guest, noted)).toHaveAttribute("aria-label", /notas personales 4/);
  await expect(cell(host, solved)).toHaveAttribute("aria-label", /resuelta por Tomás/);
  await expect.poll(() => playerOf(game, code, "Tomás").lives).toBe(2);
  const before = playerOf(game, code, "Tomás");
  const { startedAt, id: matchId } = matchOf(game, code).state;

  // El servidor del worker es compartido: puede reconstruir también partidas de otras pruebas.
  expect(await game.restart()).toBeGreaterThanOrEqual(1);
  expect(matchOf(game, code).state.id).toBe(matchId);

  // Sin tocar nada, las dos páginas vuelven a la partida reconstruida.
  await expect
    .poll(() => game.server.rooms.get(code)?.match?.state.players.get(before.id)?.connection)
    .toBe("connected");
  await expect.poll(() => playerOf(game, code, "Inés").connection).toBe("connected");
  await expect(cell(guest, solved)).toHaveAttribute("aria-label", /resuelta por ti/);
  await expect(cell(guest, noted)).toHaveAttribute("aria-label", /notas personales 4/);
  const back = playerOf(game, code, "Tomás");
  expect([back.seat, back.lives, back.score, back.mistakes]).toEqual([
    before.seat,
    before.lives,
    before.score,
    before.mistakes,
  ]);
  expect(matchOf(game, code).state.startedAt).toBe(startedAt);

  // La partida sigue: una jugada nueva (de vuelta en el modo Número) llega a la otra página.
  await guest.keyboard.press("n");
  await place(guest, after, solution[after] ?? 0);
  await expect(cell(host, after)).toHaveAttribute("aria-label", /resuelta por Tomás/);
});

test("E-16 T-32.3 the database fails for more than 10 s: nothing unconfirmed is shown, and the pending move is resent with the same id", async ({
  player,
  game,
}) => {
  const host = await player();
  const seen = record(host);
  const code = await createRoom(host, "Inés");
  const guest = await player();
  await joinRoom(guest, code, "Tomás");
  await start(host, [host, guest]);
  const solution = matchOf(game, code).solution;
  const matchId = matchOf(game, code).state.id;
  const [target] = emptyCells(game, code);
  if (target === undefined) throw new Error("No empty cell");
  const solvedAt = (index: number) =>
    seen.filter((m) => m.type === "cell.solved" && m.payload.cell === index);

  game.failDatabase(true);
  await place(guest, target, solution[target] ?? 0);
  // A los 10 s, la sala se cierra (1012) y queda reconstruyéndose: nadie vio la jugada.
  await expect.poll(() => game.server.rebuilding.has(code), { timeout: 15_000 }).toBe(true);
  expect(solvedAt(target)).toEqual([]);
  await expect(cell(host, target)).not.toHaveAttribute("aria-label", /resuelta/);

  game.failDatabase(false);
  // La sala se reconstruye desde el registro confirmado, las páginas vuelven y la de Tomás reenvía
  // la jugada pendiente con el mismo `id`.
  await expect(cell(host, target)).toHaveAttribute("aria-label", /resuelta por Tomás/);
  await expect(cell(guest, target)).toHaveAttribute("aria-label", /resuelta por ti/);
  const tomas = playerOf(game, code, "Tomás");
  expect([tomas.lives, tomas.mistakes]).toEqual([3, 0]);
  // Si la página de Inés volvió después del reenvío, la celda le llegó en el snapshot y no como
  // `cell.solved`: a lo sumo uno, nunca dos.
  expect(solvedAt(target).length).toBeLessThanOrEqual(1);
  const logged = (await game.events(matchId)).filter(
    (e) => e.type === "cell.solved" && e.payload.cell === target,
  );
  expect(logged).toHaveLength(1);
});

test("E-02 E-23 T-26.4 coming back with the token to a full room shows «no free seats»; with a free seat, the player gets their data back", async ({
  player,
  game,
  browser,
}) => {
  const host = await player();
  const code = await createRoom(host, "Inés");
  // Tomás tiene su contexto: la ficha sobrevive a sus páginas.
  const context = await browser.newContext();
  try {
    const tomas = await player({ context });
    await joinRoom(tomas, code, "Tomás");
    await start(host, [host, tomas]);
    const solution = matchOf(game, code).solution;
    const [wrong] = emptyCells(game, code);
    if (wrong === undefined) throw new Error("No empty cell");
    await place(tomas, wrong, wrongDigit(solution, wrong));
    await expect.poll(() => playerOf(game, code, "Tomás").lives).toBe(2);
    const before = playerOf(game, code, "Tomás");

    await leave(tomas);
    await expect.poll(() => playerOf(game, code, "Tomás").connection).toBe("left");

    // Cinco personas ocupan los asientos libres a mitad de partida (E-09, E-23).
    const others: Page[] = [];
    for (const name of ["Ana", "Bea", "Ciro", "Dani", "Eva"]) {
      const page = await player();
      await joinRoom(page, code, name);
      await expect(page.getByRole("grid", { name: "Tablero" })).toBeVisible();
      others.push(page);
    }

    await tomas.goto(`/#/sala/${code}`);
    await expect(tomas.getByText(`La sala ${code} no tiene asientos libres.`)).toBeVisible();
    expect(playerOf(game, code, "Tomás").connection).toBe("left");

    const eva = others.at(-1);
    if (!eva) throw new Error("No Eva");
    await leave(eva);
    // Con el aviso a la vista, el enlace vuelve a Inicio; se vuelve con «Volver a la sala».
    await tomas.getByRole("link", { name: `Volver a la sala ${code}` }).click();
    await expect(tomas.getByRole("grid", { name: "Tablero" })).toBeVisible();
    await expect.poll(() => playerOf(game, code, "Tomás").connection).toBe("connected");
    // Vuelve con sus datos, nunca con 3 vidas nuevas (E-02).
    const back = playerOf(game, code, "Tomás");
    expect([back.id, back.lives, back.mistakes, back.score]).toEqual([
      before.id,
      2,
      1,
      before.score,
    ]);
  } finally {
    await context.close();
  }
});
