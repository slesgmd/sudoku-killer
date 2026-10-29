// E2E con Playwright: el build de producción servido con `vite preview`, que reenvía `/ws` al
// servidor de salas real que arranca cada worker (e2e/fixtures.ts) en el puerto `E2E_WS_PORT`.
// Sin reintentos, también en la CI: un fallo intermitente se investiga.
import { defineConfig, devices } from "@playwright/test";

export const E2E_WEB_PORT = 4173;
export const E2E_WS_PORT = 8788;
export const E2E_ORIGIN = `http://localhost:${String(E2E_WEB_PORT)}`;

export default defineConfig({
  testDir: "e2e",
  retries: 0,
  // Un solo servidor de salas por worker, en un puerto fijo.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: E2E_ORIGIN,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm exec vite build && pnpm exec vite preview --port ${String(E2E_WEB_PORT)} --strictPort`,
    url: E2E_ORIGIN,
    env: { SK_WS_TARGET: `ws://127.0.0.1:${String(E2E_WS_PORT)}` },
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
