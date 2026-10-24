// Red local por `http://<IP>` (F8, prueba en el celular): la página no es un contexto seguro y el
// navegador no expone `crypto.randomUUID` ni `crypto.subtle`, solo `crypto.getRandomValues`. El
// servidor simulado tiene que arrancar igual, con la comprobación del hash contra el manifiesto.
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameClient } from "../src/game/client.ts";
import { memoryPrefs } from "../src/game/prefs.ts";
import { randomId } from "../src/game/random-id.ts";

let client: GameClient | null = null;

afterEach(() => {
  client?.destroy();
  client = null;
  vi.unstubAllGlobals();
});

function insecureCrypto(): void {
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
}

describe("without a secure context (only crypto.getRandomValues)", () => {
  it("randomId gives distinct version 4 UUIDs", () => {
    insecureCrypto();
    const ids = Array.from({ length: 200 }, () => randomId());
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the simulated server creates the room and loads a checked puzzle", async () => {
    insecureCrypto();
    const { createDevTransport } = await import("../src/dev/sim/index.ts");
    client = new GameClient({
      transport: createDevTransport(new URLSearchParams("lat=0")),
      prefs: memoryPrefs(),
    });
    client.start("Inés", "expert");
    await vi.waitFor(
      () => {
        expect(client?.getState().phase).toBe("playing");
      },
      { timeout: 10_000, interval: 10 },
    );
    expect(client.getState().match?.puzzle.difficulty).toBe("expert");
    expect(client.getState().startFailed).toBe(false);
  });
});
