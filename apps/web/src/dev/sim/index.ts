// Entrada del servidor simulado de desarrollo. Opciones por la URL:
// - `lat`: latencia de cada mensaje, en milisegundos (por defecto 120, para ver la jugada pendiente).
// - `skew`: desfase del reloj del servidor respecto del navegador, en milisegundos (T-07.2).
// - `bot`: cuántos bots compañeros entran al crear la sala (por defecto 0, como máximo 5).
// - `pace`: tiempo medio entre jugadas de cada bot, en milisegundos (por defecto 4000).
// - `errors`: probabilidad de que un bot se equivoque a propósito, de 0 a 1 (por defecto 0,1).
// - `seed`: semilla de los bots (por defecto 1).
import { createRng } from "@sudoku-killer/engine";
import { randomId } from "../../game/random-id.ts";
import { Bot } from "../bot/bot.ts";
import type { Transport } from "../../transport/types.ts";
import { reportLoadTime } from "../load-time.ts";
import { loadPuzzle } from "./puzzles.ts";
import { SimServer } from "./server.ts";
import { createSimTransport } from "./transport.ts";

const DEFAULT_LATENCY_MS = 120;

function numberParam(params: URLSearchParams, name: string, fallback: number): number {
  const value = Number(params.get(name));
  return params.has(name) && Number.isFinite(value) ? value : fallback;
}

const BOT_NAMES = ["Tomás", "Valeria", "Rafa", "Bruno", "Inés"];

let server: SimServer | null = null;
let bots: Bot[] = [];

export function createDevTransport(params: URLSearchParams): Transport {
  if (!server) {
    const skew = numberParam(params, "skew", 0);
    const latency = numberParam(params, "lat", DEFAULT_LATENCY_MS);
    const botCount = Math.min(5, Math.max(0, Math.floor(numberParam(params, "bot", 0))));
    const pace = numberParam(params, "pace", 4000);
    const errorRate = Math.min(1, Math.max(0, numberParam(params, "errors", 0.1)));
    const botSeed = numberParam(params, "seed", 1);
    // El simulador no es un paquete puro: la semilla sale de la hora de la página.
    const rng = createRng(Date.now() >>> 0);
    const randomInt = (bound: number) => rng.int(bound);
    server = new SimServer({
      now: () => Date.now() + skew,
      randomId,
      randomInt,
      onRoomCreated(code) {
        for (const bot of bots) bot.stop();
        bots = Array.from({ length: botCount }, (_, i) => {
          if (!server) throw new Error("No simulated server");
          return new Bot({
            transport: createSimTransport(server, latency),
            code,
            nickname: BOT_NAMES[i] ?? `Bot ${String(i + 1)}`,
            seed: botSeed + i,
            paceMs: pace,
            errorRate,
          });
        });
      },
      async loadPuzzle(difficulty) {
        const loaded = await loadPuzzle(difficulty, randomInt, randomId());
        console.info(
          `[sim] ${difficulty}: seed ${String(loaded.entry.seed)} loaded in ${loaded.ms.toFixed(0)} ms`,
        );
        reportLoadTime({ ms: loaded.ms, difficulty, seed: loaded.entry.seed });
        return loaded;
      },
    });
  }
  return createSimTransport(server, numberParam(params, "lat", DEFAULT_LATENCY_MS));
}
