// E2E de los límites por IP y del acceso abierto (SPEC R-39 y R-40) contra el servidor real, con la
// CSP y el inspector de filtración activos. Todas las páginas llegan desde 127.0.0.1: la misma red.
// Las esperas de T-40.13 son cortas porque las fija la prueba, no porque se haya subido ningún plazo.
import type { Page } from "@playwright/test";
import { IP_LIMITS } from "../../server/src/rooms/limits.ts";
import { createRoom, expect, joinRoom, test } from "./fixtures.ts";
import { at, emptyCells, matchOf, place, start } from "./game.ts";

const NO_ROOM = "ZZZZZZ";
const OLD_KEY = "ABCD-EFGH-JKMN-PQRS";
const SHORT_WAIT = { windowMs: 10_000, waitMs: 3_000 };

test.afterEach(({ game }) => {
  game.setIpLimits(null);
});

/** Pulsa «Entrar» con un código que no existe y espera esa respuesta, por una conexión nueva. */
async function tryCode(page: Page, code: string): Promise<void> {
  const socket = page.waitForEvent("websocket");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await (
    await socket
  ).waitForEvent("framereceived", ({ payload }) => String(payload).includes("room.not_found"));
  await expect(page.getByText(`con el código ${code}`)).toBeVisible();
}

async function openEntry(page: Page, code: string): Promise<void> {
  await page.goto("/#/entrar");
  await page.getByLabel("Tu apodo").fill("Inés");
  await page.getByLabel("Código de la sala").fill(code);
}

test("T-40.13 wrong codes lead to a clear wait with a countdown: «Crear» keeps working and, when it ends, «Entrar» works again", async ({
  player,
  game,
}) => {
  game.setIpLimits({ join: [{ max: 2, ...SHORT_WAIT }] });
  const page = await player();
  await openEntry(page, NO_ROOM);
  for (let i = 0; i < 3; i++) await tryCode(page, NO_ROOM);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();

  const alert = page.getByRole("alert").filter({ hasText: "Demasiados intentos" });
  await expect(alert).toContainText("códigos que no existen");
  await expect(alert.getByRole("timer")).toHaveText(/^0:0[1-3]$/);
  await expect(page.getByLabel("Tu apodo")).toHaveValue("Inés");
  await expect(page.getByLabel("Código de la sala")).toHaveValue(NO_ROOM);
  expect(game.ipLimits.join.locked).toBe(1);
  await expect(page.getByRole("button", { name: "Crear sala nueva" })).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );

  await expect(alert).toBeHidden();
  await tryCode(page, NO_ROOM);
});

test("T-40.13 too many connections from one network: no «Clave del grupo», a countdown, and the page goes in by itself", async ({
  player,
  game,
}) => {
  game.setIpLimits({ connect: [{ max: 1, ...SHORT_WAIT }] });
  const host = await player();
  await createRoom(host, "Inés");
  const guest = await player();
  await guest.goto("/#/entrar");
  await guest.getByLabel("Tu apodo").fill("Tomás");
  await guest.getByRole("button", { name: "Crear sala nueva" }).click();
  await expect(guest.getByText("Demasiadas conexiones desde tu red.")).toBeVisible();
  await expect(guest.getByRole("timer")).toHaveText(/^0:0[1-3]$/);
  await expect(guest.getByRole("heading", { name: "Clave del grupo" })).toBeHidden();
  await expect(guest.getByText("Despertando el servidor…")).toBeHidden();
  await expect(guest.getByRole("heading", { name: "Sala de espera" })).toBeVisible();
  expect(game.ipLimits.connect.locked).toBeGreaterThan(0);
});

test("T-40.14 with the production values, six people on one network with a stale link and one retry are not blocked, and a match of six touches no limit", async ({
  player,
  game,
}) => {
  game.setIpLimits(IP_LIMITS);
  const pages: Page[] = [];
  for (let i = 0; i < 6; i++) pages.push(await player());

  for (const page of pages) {
    await page.goto(`/#/sala/${NO_ROOM}`);
    await expect(page.getByLabel("Código de la sala")).toHaveValue(NO_ROOM);
    await page.getByLabel("Tu apodo").fill("Inés");
  }
  for (const page of pages) {
    await tryCode(page, NO_ROOM);
    await tryCode(page, NO_ROOM);
  }

  const [host = at(pages, 0), ...guests] = pages;
  const code = await createRoom(host, "Inés");
  for (const [i, guest] of guests.entries()) await joinRoom(guest, code, `Jugador${String(i)}`);
  await start(host, pages);
  const solution = matchOf(game, code).solution;
  for (const [i, page] of pages.entries()) {
    const index = at(emptyCells(game, code), i);
    await place(page, index, at(solution, index));
  }
  // Una ronda completa de reconexión.
  for (const page of pages) await page.reload();
  await expect(host.getByRole("grid")).toBeVisible();

  const { join, create, connect, events } = game.ipLimits;
  expect([join.locked, create.locked, connect.locked, events.locked]).toEqual([0, 0, 0, 0]);
});

test("T-39.20 with the server open nobody is asked for a key, also with an old key stored; «Compartir» carries only the room", async ({
  player,
}) => {
  const page = await player();
  await page.addInitScript(
    (key) => {
      const shared: string[] = [];
      Object.assign(window, { shared });
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: (text: string) => Promise.resolve(void shared.push(text)) },
        configurable: true,
      });
      localStorage.setItem("sk:access", key);
    },
    OLD_KEY.replaceAll("-", ""),
  );
  const code = await createRoom(page, "Inés");
  await expect(page.getByRole("heading", { name: "Clave del grupo" })).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("sk:access"))).toBe(
    OLD_KEY.replaceAll("-", ""),
  );
  await page.getByRole("button", { name: "Compartir" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as { shared?: string[] }).shared?.at(-1)))
    .toMatch(new RegExp(`/#/sala/${code}$`));

  const visitor = await player();
  await joinRoom(visitor, code, "Tomás");
  await expect(visitor.getByRole("heading", { name: "Sala de espera" })).toBeVisible();
});

test("T-39.21 an old invitation link with the server open ends at home without asking for anything", async ({
  player,
}) => {
  const page = await player();
  await page.goto(`/#k=${encodeURIComponent(OLD_KEY)}`);
  await expect.poll(() => new URL(page.url()).hash).toBe("#/");
  await expect(page.getByRole("heading", { name: "Comprobando el enlace…" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Clave del grupo" })).toBeHidden();
  await expect(page.getByLabel("Clave")).toBeHidden();
  await createRoom(page, "Inés");
});
