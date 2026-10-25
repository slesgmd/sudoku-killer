// La prueba de humo del despliegue (F12b, `scripts/smoke.ts`) contra el servidor real en 127.0.0.1:
// el handshake con un origen ajeno da 403 y con el permitido abre.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { tryWebSocket } from "../scripts/smoke.ts";
import { testBank } from "./helpers/server.ts";
import { TEST_ORIGIN, startWsServer, type RunningWsServer } from "./helpers/ws-server.ts";

let running: RunningWsServer | null = null;

beforeAll(async () => {
  await testBank();
}, 60_000);

afterEach(async () => {
  await running?.stop();
  running = null;
});

describe("F12 smoke test", () => {
  it("sees 403 for a foreign origin and an open socket for the allowed one", async () => {
    running = await startWsServer();
    const url = `ws://127.0.0.1:${String(running.port)}/ws`;
    expect(await tryWebSocket(url, "https://otro-sitio.example")).toEqual({
      opened: false,
      status: 403,
    });
    expect((await tryWebSocket(url, TEST_ORIGIN)).opened).toBe(true);
  });
});
