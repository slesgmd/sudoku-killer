// URL del servidor de salas en producción (ADR 0007): solo `wss://…/ws`; sin configurar, el
// mismo origen; el precalentamiento con `GET /ws` en el mismo host.
import { describe, expect, it } from "vitest";
import { checkServerUrl, prewarmUrl, probeUrl, serverUrl } from "../src/transport/server-url.ts";

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

  it("derives GET /ws over HTTP from the WebSocket URL", () => {
    expect(probeUrl("wss://sk-ws.example/ws")).toBe("https://sk-ws.example/ws");
    expect(probeUrl("ws://127.0.0.1:8080/ws")).toBe("http://127.0.0.1:8080/ws");
  });

  it("F12g prewarms the configured server only, with GET /ws", () => {
    expect(prewarmUrl("wss://sk-ws.example/ws")).toBe("https://sk-ws.example/ws");
    expect(prewarmUrl(undefined)).toBeNull();
  });

  it("F12g the prewarm is not caught by the EasyPrivacy rule that Brave applies (||onrender.com/health)", () => {
    // La regla bloquea cualquier subdominio de onrender.com con una ruta que empieza por /health.
    const blocked = (href: string) => {
      const url = new URL(href);
      return /(^|\.)onrender\.com$/.test(url.hostname) && url.pathname.startsWith("/health");
    };
    const warm = prewarmUrl("wss://sudoku-killer-lima-ws.onrender.com/ws");
    expect(warm).toBe("https://sudoku-killer-lima-ws.onrender.com/ws");
    expect(blocked(warm ?? "")).toBe(false);
    // Verificación negativa: el precalentamiento anterior, `/healthz`, sí cae en la regla.
    expect(blocked("https://sudoku-killer-lima-ws.onrender.com/healthz")).toBe(true);
  });
});
