// La prueba de humo del despliegue (`scripts/smoke.ts`) contra el servidor real en 127.0.0.1:
// el handshake con un origen ajeno da 403 y con el permitido abre; `POST /access` sin clave y con una
// inválida da 401 también detrás de un proxy que pierde el 4003 (T-39.17). Y la comparación de las
// cabeceras de seguridad con las que sirve Render.
import { ACCESS_PROTOCOL, CLOSE_ACCESS_DENIED, accessProtocols } from "@sudoku-killer/protocol";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { securityHeaders } from "../../web/scripts/security-headers.ts";
import { checkAccess, checkSecurityHeaders, tryWebSocket } from "../scripts/smoke.ts";
import { lossyProxy } from "./helpers/lossy-proxy.ts";
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

  it("T-39.17 POST /access gives 401 without a key and with a random one, also behind a proxy that loses the 4003", async () => {
    const KEY = "ABCD-EFGH-JKMN-PQRS";
    running = await startWsServer({ accessKey: KEY });
    const proxy = await lossyProxy(running.port, { mode: "close" });
    try {
      const url = `ws://127.0.0.1:${String(proxy.port)}/ws`;
      expect(await checkAccess(url, TEST_ORIGIN)).toEqual([
        ["access_keyless_401", true],
        ["access_wrong_key_401", true],
        ["access_foreign_origin_403", true],
      ]);
    } finally {
      await proxy.close();
    }
    // Sin el proxy, la clave abre el WebSocket; sin clave, el 4003 sigue de respaldo.
    const direct = `ws://127.0.0.1:${String(running.port)}/ws`;
    expect(await tryWebSocket(direct, TEST_ORIGIN, accessProtocols(KEY))).toEqual({
      opened: true,
      closeCode: 1000,
    });
    expect((await tryWebSocket(direct, TEST_ORIGIN, [ACCESS_PROTOCOL])).closeCode).toBe(
      CLOSE_ACCESS_DENIED,
    );
    // Una sola clave rechazada por corrida (la inventada); sin clave no es un intento.
    expect(running.access.denied).toBe(1);
    expect(running.access.missing).toBe(2);
  });

  it("negative check: against a server that asks for no key the access checks fail", async () => {
    running = await startWsServer();
    const url = `ws://127.0.0.1:${String(running.port)}/ws`;
    expect(await checkAccess(url, TEST_ORIGIN)).toEqual([
      ["access_keyless_401", false],
      ["access_wrong_key_401", false],
      ["access_foreign_origin_403", true],
    ]);
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
