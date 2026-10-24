// Entrada del servidor simulado de desarrollo. Opciones por la URL:
// - `lat`: latencia de cada mensaje, en milisegundos (por defecto 120, para ver la jugada pendiente).
// - `skew`: desfase del reloj del servidor respecto del navegador, en milisegundos (T-07.2).
import { createRng } from "@sudoku-killer/engine";
import type { Transport } from "../../transport/types.ts";
import { loadPuzzle } from "./puzzles.ts";
import { SimServer } from "./server.ts";
import { createSimTransport } from "./transport.ts";

const DEFAULT_LATENCY_MS = 120;

function numberParam(params: URLSearchParams, name: string, fallback: number): number {
  const value = Number(params.get(name));
  return params.has(name) && Number.isFinite(value) ? value : fallback;
}

let server: SimServer | null = null;

export function createDevTransport(params: URLSearchParams): Transport {
  if (!server) {
    const skew = numberParam(params, "skew", 0);
    // El simulador no es un paquete puro: la semilla sale de la hora de la página.
    const rng = createRng(Date.now() >>> 0);
    const randomInt = (bound: number) => rng.int(bound);
    server = new SimServer({
      now: () => Date.now() + skew,
      randomId: () => crypto.randomUUID(),
      randomInt,
      async loadPuzzle(difficulty) {
        const loaded = await loadPuzzle(difficulty, randomInt, crypto.randomUUID());
        console.info(
          `[sim] ${difficulty}: seed ${String(loaded.entry.seed)} loaded in ${loaded.ms.toFixed(0)} ms`,
        );
        return loaded;
      },
    });
  }
  return createSimTransport(server, numberParam(params, "lat", DEFAULT_LATENCY_MS));
}
