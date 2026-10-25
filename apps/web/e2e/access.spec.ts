// E2E de la clave de acceso del grupo (F12, R-39, `docs/seguridad.md` S-02) contra el servidor real:
// el enlace de invitación guarda la clave y la saca de la URL; la clave nunca aparece en la URL del
// WebSocket ni en la página, y el enlace de la sala no la lleva; sin clave, o con una que no vale,
// la página pide «Clave del grupo» y, con la vigente, entra a la sala.
import type { Page } from "@playwright/test";
import { createRoom, expect, test } from "./fixtures.ts";

const KEY = "QWER-TYPA-SDFG-HJKZ";

/** Las URL de los WebSocket que abre la página. */
function socketUrls(page: Page): string[] {
  const urls: string[] = [];
  page.on("websocket", (ws) => urls.push(ws.url()));
  return urls;
}

test("T-39.6 the invitation link stores the key, a page without it asks for it, and the key never shows in a URL or the page", async ({
  player,
  game,
}) => {
  game.requireAccessKey(KEY);
  try {
    const host = await player();
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
    await host.goto(`/#k=${encodeURIComponent(KEY.toLowerCase())}`);
    await expect.poll(() => new URL(host.url()).hash).toBe("#/");
    expect(await host.evaluate(() => localStorage.getItem("sk:access"))).toBe("QWERTYPASDFGHJKZ");
    const code = await createRoom(host, "Inés");
    // El enlace de la sala («Compartir») solo lleva el código, nunca la clave.
    await host.getByRole("button", { name: "Compartir" }).click();
    await expect
      .poll(() => host.evaluate(() => (window as { shared?: string[] }).shared?.at(-1)))
      .toMatch(new RegExp(`/#/sala/${code}$`));
    expect(await host.content()).not.toMatch(/QWER|qwer|k=/);
    expect(hostSockets.length).toBeGreaterThan(0);
    for (const url of hostSockets) expect(url).toMatch(/\/ws$/);

    // Otra persona abre el enlace de la sala sin la clave.
    const guest = await player();
    await guest.goto(`/#/sala/${code}`);
    await guest.getByLabel("Tu apodo").fill("Tomás");
    await guest.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(guest.getByRole("heading", { name: "Clave del grupo" })).toBeVisible();
    await expect(guest.getByText(/Este juego es privado/)).toBeVisible();

    // Una clave que no vale: se olvida y se vuelve a pedir.
    await guest.getByLabel("Clave").fill("WXYZ-WXYZ-WXYZ-WXYZ");
    await guest.getByRole("button", { name: "Continuar" }).click();
    await expect(guest.getByText(/ya no vale/)).toBeVisible();
    expect(await guest.evaluate(() => localStorage.getItem("sk:access"))).toBeNull();

    await guest.getByLabel("Clave").fill(KEY);
    await guest.getByRole("button", { name: "Continuar" }).click();
    for (const page of [host, guest]) {
      await expect(page.getByRole("heading", { name: "Sala de espera" })).toBeVisible();
      await expect(page.getByText("Tomás")).toBeVisible();
    }
  } finally {
    game.requireAccessKey(null);
  }
});
