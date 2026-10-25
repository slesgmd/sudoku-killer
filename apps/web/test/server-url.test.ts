// URL del servidor de salas en producción (F12b, ADR 0007): solo `wss://…/ws`; sin configurar, el
// mismo origen; el chequeo de salud en el mismo host.
import { describe, expect, it } from "vitest";
import { checkServerUrl, healthUrl, serverUrl } from "../src/transport/server-url.ts";

const page = { protocol: "https:", host: "sk-web.example" };

describe("F12 server URL", () => {
  it("uses VITE_SERVER_URL when it is set, and the same origin when it is not", () => {
    expect(serverUrl("wss://sk-ws.example/ws", page)).toBe("wss://sk-ws.example/ws");
    expect(serverUrl(undefined, page)).toBe("wss://sk-web.example/ws");
    expect(serverUrl("  ", { protocol: "http:", host: "localhost:4173" })).toBe(
      "ws://localhost:4173/ws",
    );
  });

  it("rejects anything that is not wss:// with the /ws path", () => {
    expect(() => checkServerUrl("ws://sk-ws.example/ws")).toThrow(/wss:\/\//);
    expect(() => checkServerUrl("https://sk-ws.example/ws")).toThrow(/wss:\/\//);
    expect(() => checkServerUrl("wss://sk-ws.example/")).toThrow(/\/ws/);
    expect(() => checkServerUrl("wss://sk-ws.example/ws?k=1")).toThrow(/\/ws/);
    expect(() => checkServerUrl("wss://sk-ws.example/ws#k=1")).toThrow(/\/ws/);
    expect(() => checkServerUrl("wss://user:pass@sk-ws.example/ws")).toThrow(/credenciales/);
    expect(() => checkServerUrl("no es una url")).toThrow(/válida/);
  });

  it("derives the health check from the WebSocket URL", () => {
    expect(healthUrl("wss://sk-ws.example/ws")).toBe("https://sk-ws.example/healthz");
    expect(healthUrl("ws://127.0.0.1:8080/ws")).toBe("http://127.0.0.1:8080/healthz");
  });
});
