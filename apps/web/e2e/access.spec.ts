// E2E de la clave de acceso del grupo (F12, R-39, `docs/seguridad.md` S-02) contra el servidor real:
// el enlace de invitación pasa la clave por `POST /access` y la saca de la URL; la clave nunca
// aparece en la URL del WebSocket ni en la página, y el enlace de la sala no la lleva.
// Detrás de un proxy que pierde el cierre del servidor, como el de Render (T-39.16), la página no
// depende del 4003: sin clave, con una que no vale, con una guardada que dejó de valer y con la
// dirección bloqueada, decide con `POST /access` antes de abrir ningún WebSocket.
// Verificación negativa: con `SK_E2E_SKIP_ACCESS_CHECK=1`, `POST /access` responde 204 a todo en el
// navegador (como un cliente que no comprobara la clave) y las pruebas de T-39.16 fallan: el 4003 no
// llega y la página nunca pide la clave.
import type { Page } from "@playwright/test";
import { ACCESS_KEY_HEADER, encodeAccessKey } from "@sudoku-killer/protocol";
import { MAX_ACCESS_FAILURES } from "../../server/src/infra/access.ts";
import { E2E_ORIGIN, E2E_WS_PORT } from "../playwright.config.ts";
import { createRoom, expect, test } from "./fixtures.ts";

const KEY = "QWER-TYPA-SDFG-HJKZ";
const NORMALIZED = "QWERTYPASDFGHJKZ";
const WRONG = "WXYZ-WXYZ-WXYZ-WXYZ";
const SKIP_CHECK = process.env["SK_E2E_SKIP_ACCESS_CHECK"] === "1";

test.beforeEach(({ game }) => {
  game.requireAccessKey(KEY);
  game.loseServerClose(true);
});

test.afterEach(({ game }) => {
  game.requireAccessKey(null);
  game.loseServerClose(false);
  game.forgetAccessFailures();
});

/** Las URL de los WebSocket que abre la página. */
function socketUrls(page: Page): string[] {
  const urls: string[] = [];
  page.on("websocket", (ws) => urls.push(ws.url()));
  return urls;
}

/** Una página nueva, con la verificación negativa aplicada si se pidió. */
async function visitor(player: () => Promise<Page>): Promise<Page> {
  const page = await player();
  if (SKIP_CHECK) await page.route("**/access", (route) => route.fulfill({ status: 204 }));
  return page;
}

async function typeKey(page: Page, key: string): Promise<void> {
  await page.getByLabel("Clave").fill(key);
  await page.getByRole("button", { name: "Continuar" }).click();
}

test("T-39.6 the invitation link stores the key once it works, and the key never shows in a URL or the page", async ({
  player,
}) => {
  const host = await visitor(player);
  const hostSockets = socketUrls(host);
  // Sin hoja de compartir: «Compartir» copia el enlace, y aquí se guarda lo copiado.
  await host.addInitScript(() => {
    const shared: string[] = [];
    Object.assign(window, { shared });
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: (text: string) => Promise.resolve(void shared.push(text)) },
      configurable: true,
    });
  });
  const checks: string[] = [];
  host.on("request", (request) => {
    if (new URL(request.url()).pathname === "/access") checks.push(request.url());
  });
  await host.goto(`/#k=${encodeURIComponent(KEY.toLowerCase())}`);
  await expect.poll(() => new URL(host.url()).hash).toBe("#/");
  await expect.poll(() => host.evaluate(() => localStorage.getItem("sk:access"))).toBe(NORMALIZED);
  const code = await createRoom(host, "Inés");
  // El enlace de la sala («Compartir») solo lleva el código, nunca la clave.
  await host.getByRole("button", { name: "Compartir" }).click();
  await expect
    .poll(() => host.evaluate(() => (window as { shared?: string[] }).shared?.at(-1)))
    .toMatch(new RegExp(`/#/sala/${code}$`));
  expect(await host.content()).not.toMatch(/QWER|qwer|k=/);
  expect(hostSockets.length).toBeGreaterThan(0);
  for (const url of hostSockets) expect(url).toMatch(/\/ws$/);
  expect(checks.length).toBeGreaterThan(0);
  for (const url of checks) expect(url).toMatch(/\/access$/);
});

test("T-39.16 behind a proxy that loses the 4003: without a key, with a wrong one and with the right one", async ({
  player,
}) => {
  const host = await visitor(player);
  await host.addInitScript((key) => {
    localStorage.setItem("sk:access", key);
  }, NORMALIZED);
  const code = await createRoom(host, "Inés");

  // Otra persona abre el enlace de la sala sin la clave: «Clave del grupo», sin abrir un WebSocket.
  const guest = await visitor(player);
  const guestSockets = socketUrls(guest);
  await guest.goto(`/#/sala/${code}`);
  await guest.getByLabel("Tu apodo").fill("Tomás");
  await guest.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(guest.getByRole("heading", { name: "Clave del grupo" })).toBeVisible();
  await expect(guest.getByText(/Este juego es privado/)).toBeVisible();
  expect(guestSockets).toEqual([]);

  // Una clave que no vale: se dice y no se guarda.
  await typeKey(guest, WRONG);
  await expect(guest.getByText(/Esa clave no vale/)).toBeVisible();
  expect(await guest.evaluate(() => localStorage.getItem("sk:access"))).toBeNull();
  expect(guestSockets).toEqual([]);

  // La vigente: se guarda y se entra a la sala.
  await typeKey(guest, KEY);
  for (const page of [host, guest]) {
    await expect(page.getByRole("heading", { name: "Sala de espera" })).toBeVisible();
    await expect(page.getByText("Tomás")).toBeVisible();
  }
  expect(await guest.evaluate(() => localStorage.getItem("sk:access"))).toBe(NORMALIZED);
});

test("T-39.16 a stored key that stopped working and an invitation with a wrong key ask for the key again", async ({
  player,
}) => {
  const page = await visitor(player);
  const sockets = socketUrls(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded") === null) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("sk:access", "OLDKEYOLDKEYOLD");
    }
  });
  await page.goto("/#/entrar");
  await page.getByLabel("Tu apodo").fill("Inés");
  await page.getByRole("button", { name: "Crear sala nueva" }).click();
  await expect(page.getByText(/ya no vale/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("sk:access"))).toBeNull();
  expect(sockets).toEqual([]);

  // Una invitación con una clave que no vale (abierta como enlace, en una carga nueva): la pide, sin
  // guardarla.
  await page.goto("about:blank");
  await page.goto(`/#k=${encodeURIComponent(WRONG)}`);
  await expect(page.getByRole("heading", { name: "Clave del grupo" })).toBeVisible();
  await expect(page.getByText(/Esa clave no vale/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("sk:access"))).toBeNull();
  expect(new URL(page.url()).hash).toBe("#/");
  expect(sockets).toEqual([]);

  await typeKey(page, KEY);
  await expect(page.getByRole("heading", { name: "Clave del grupo" })).toBeHidden();
  await createRoom(page, "Inés");
});

test("T-39.16 with the address locked out by wrong keys, the page asks to wait instead of connecting", async ({
  player,
  game,
}) => {
  // Diez claves que no valen desde 127.0.0.1, la dirección de todas las páginas en las E2E.
  for (let i = 0; i < MAX_ACCESS_FAILURES; i++) {
    const response = await fetch(`http://127.0.0.1:${String(E2E_WS_PORT)}/access`, {
      method: "POST",
      headers: { origin: E2E_ORIGIN, [ACCESS_KEY_HEADER]: encodeAccessKey(WRONG) ?? "" },
    });
    expect(response.status).toBe(401);
  }
  const page = await visitor(player);
  const sockets = socketUrls(page);
  await page.addInitScript((key) => {
    localStorage.setItem("sk:access", key);
  }, NORMALIZED);
  await page.goto("/#/entrar");
  await page.getByLabel("Tu apodo").fill("Inés");
  await page.getByRole("button", { name: "Crear sala nueva" }).click();
  await expect(page.getByText(/Demasiados intentos/)).toBeVisible();
  await expect(page.getByText(/Despertando el servidor/)).toBeHidden();
  // La guardada se conserva, y no se abrió ningún WebSocket.
  expect(await page.evaluate(() => localStorage.getItem("sk:access"))).toBe(NORMALIZED);
  expect(sockets).toEqual([]);

  // Pasada la espera, «Reintentar» entra con la clave guardada.
  game.forgetAccessFailures();
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByRole("heading", { name: "Sala de espera" })).toBeVisible();
});
