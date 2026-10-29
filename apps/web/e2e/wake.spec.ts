// E2E del servidor dormido (ADR 0007): con el servidor sin escuchar al entrar, Entrar avisa
// «Despertando el servidor…» y, cuando el servidor arranca, entra a la sala sin que la persona haga
// nada. Las demás ramas (plazo de 2 min y «Reintentar») están en `test/wake.test.tsx`.
import { expect, test } from "./fixtures.ts";

test("F12g with the server asleep, Enter says it is waking up and gets into the room once it answers", async ({
  player,
  game,
}) => {
  const page = await player();
  await page.goto("/#/entrar");
  await game.sleep();
  try {
    await page.getByLabel("Tu apodo").fill("Inés");
    await page.getByRole("button", { name: "Crear sala nueva" }).click();
    await expect(page.getByText("Despertando el servidor…")).toBeVisible();
    // Pasa el plazo de `unavailable` (10 s) sin cortar la entrada.
    await page.waitForTimeout(11_000);
    await expect(page.getByText("Despertando el servidor…")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reintentar" })).toHaveCount(0);
  } finally {
    await game.wake();
  }
  await expect(page.getByRole("heading", { name: "Sala de espera" })).toBeVisible();
  await expect(page.getByText("Despertando el servidor…")).toHaveCount(0);
});
