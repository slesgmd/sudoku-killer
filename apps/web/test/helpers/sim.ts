// Ayudas de las pruebas del cliente: un servidor simulado con puzzles del banco y un cliente
// conectado a él. Guarda la solución del puzzle cargado para que la prueba pueda jugar.
import { createRng } from "@sudoku-killer/engine";
import { vi } from "vitest";
import { regenerateEntry, loadManifest } from "../../src/dev/sim/puzzles.ts";
import { SimServer } from "../../src/dev/sim/server.ts";
import { createSimTransport } from "../../src/dev/sim/transport.ts";
import { GameClient } from "../../src/game/client.ts";
import { memorySession } from "../../src/game/session.ts";

export interface SimHarness {
  readonly server: SimServer;
  readonly client: GameClient;
  /** Solución del último puzzle cargado. */
  readonly solution: () => readonly number[];
  /** Espera a que el servidor procese todo y lleguen las respuestas. */
  readonly settle: () => Promise<void>;
}

export interface HarnessOptions {
  /** Reloj del servidor. */
  readonly serverNow?: () => number;
  /** Reloj del cliente. */
  readonly clientNow?: () => number;
  /** Primera semilla de la dificultad, en lugar de una al azar. */
  readonly first?: boolean;
  /** Latencia del transporte simulado, en milisegundos (`?lat=`). */
  readonly latencyMs?: number;
}

export function createHarness({
  serverNow = () => Date.now(),
  clientNow,
  first = true,
  latencyMs = 0,
}: HarnessOptions = {}): SimHarness {
  let solution: readonly number[] = [];
  const rng = createRng(7);
  let ids = 0;
  const server = new SimServer({
    now: serverNow,
    randomId: () => `id-${String(++ids)}`,
    randomInt: (bound) => rng.int(bound),
    async loadPuzzle(difficulty) {
      const entries = (await loadManifest()).entries.filter((e) => e.difficulty === difficulty);
      const entry = first ? entries[0] : entries[rng.int(entries.length)];
      if (!entry) throw new Error(difficulty);
      const loaded = await regenerateEntry(entry, `puzzle-${String(entry.seed)}`);
      solution = loaded.solution;
      return loaded;
    },
  });
  const client = new GameClient({
    transport: createSimTransport(server, latencyMs),
    session: memorySession(),
    ...(clientNow ? { now: clientNow } : {}),
  });
  const settle = async () => {
    await vi.dynamicImportSettled();
    for (let i = 0; i < 6; i++) {
      await server.settled();
      await new Promise<void>((resolve) => {
        queueMicrotask(resolve);
      });
    }
  };
  return { server, client, solution: () => solution, settle };
}
