// La prueba de humo del despliegue (F12b, `scripts/smoke.ts`) contra el servidor real en 127.0.0.1:
// el handshake con un origen ajeno da 403, con el permitido abre y, sin la clave, recibe 4003. Y la
// comparación de las cabeceras de seguridad con las que sirve Render.
import { ACCESS_PROTOCOL, CLOSE_ACCESS_DENIED, accessProtocols } from "@sudoku-killer/protocol";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { securityHeaders } from "../../web/scripts/security-headers.ts";
import { checkSecurityHeaders, tryWebSocket } from "../scripts/smoke.ts";
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

  it("T-39.11 sees 4003 without the key, the way the browser gets it, and an open socket with it", async () => {
    const KEY = "ABCD-EFGH-JKMN-PQRS";
    running = await startWsServer({ accessKey: KEY });
    const url = `ws://127.0.0.1:${String(running.port)}/ws`;
    expect(await tryWebSocket(url, TEST_ORIGIN, [ACCESS_PROTOCOL])).toEqual({
      opened: true,
      closeCode: CLOSE_ACCESS_DENIED,
    });
    expect(await tryWebSocket(url, TEST_ORIGIN, accessProtocols(KEY))).toEqual({
      opened: true,
      closeCode: 1000,
    });
  });
});

describe("F12 smoke test: security headers", () => {
  const SERVER = "wss://sudoku-killer-lima-ws.onrender.com/ws";
  const expected = securityHeaders(SERVER);
  const served = (overrides: Record<string, string | null>) => {
    const map = new Map(expected.map(({ name, value }) => [name.toLowerCase(), value]));
    for (const [name, value] of Object.entries(overrides))
      if (value === null) map.delete(name.toLowerCase());
      else map.set(name.toLowerCase(), value);
    return { get: (name: string) => map.get(name.toLowerCase()) ?? null };
  };
  const failing = (overrides: Record<string, string | null>) =>
    checkSecurityHeaders(expected, served(overrides))
      .filter(([, ok]) => !ok)
      .map(([name]) => name);

  it("accepts the stricter HSTS that Render serves on onrender.com (the smoke failure of F12j)", () => {
    // Lo que respondió https://sudoku-killer-lima.onrender.com el 2026-10-25.
    expect(
      failing({
        "Strict-Transport-Security": "max-age=315360000; includeSubdomains; preload",
      }),
    ).toEqual([]);
    expect(failing({})).toEqual([]);
  });

  it("negative check: a weaker or missing HSTS, a different CSP or a missing header fail", () => {
    expect(failing({ "Strict-Transport-Security": "max-age=86400" })).toEqual([
      "Strict-Transport-Security",
    ]);
    expect(failing({ "Strict-Transport-Security": "includeSubdomains" })).toEqual([
      "Strict-Transport-Security",
    ]);
    expect(failing({ "Strict-Transport-Security": null })).toEqual(["Strict-Transport-Security"]);
    expect(
      failing({
        "Content-Security-Policy": securityHeaders("wss://otro.onrender.com/ws")[0]?.value ?? "",
      }),
    ).toEqual(["Content-Security-Policy"]);
    expect(failing({ "X-Frame-Options": null })).toEqual(["X-Frame-Options"]);
  });
});
