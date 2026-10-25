// Control del inspector de E2E (como el fixture de control de T-31.2 con el build): un mensaje con
// la solución serializada, inyectado en el tráfico WS real de una página, tiene que dar una
// violación. Si el inspector no viera el tráfico o no detectara la filtración, esta prueba fallaría.
import { cell, createRoom, expect, test } from "./fixtures.ts";

test("control: the E2E inspector flags a frame with the serialized solution", async ({
  controlPage,
  game,
}) => {
  const { page, inspector, inject } = controlPage;
  const code = await createRoom(page, "Inés");
  await page.getByRole("button", { name: "Iniciar partida" }).click();
  await expect(cell(page, 0)).toBeVisible();
  // El tráfico real pasa limpio.
  expect(inspector.inspected).toBeGreaterThan(0);
  expect(inspector.violations).toEqual([]);

  const solution = game.solution(code);
  inject(
    JSON.stringify({
      v: 1,
      type: "sys.pong",
      payload: { t0: 0, serverNow: Date.now(), debug: solution.join("") },
    }),
  );
  await expect.poll(() => inspector.violations.length).toBe(1);
  expect(inspector.violations[0]).toMatch(
    /^client \d+: solution: serialized solution in .*"sys\.pong"/,
  );
  console.log(`Control violation: ${inspector.violations[0] ?? ""}`);
});
