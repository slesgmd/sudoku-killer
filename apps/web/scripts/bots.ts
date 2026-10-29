// Bots compañeros contra el servidor real (solo desarrollo): entran a una sala existente como
// clientes Node por WebSocket y juegan por el protocolo v1 sin ver la solución (`src/dev/bot/`).
// Sirven para probar con varios jugadores desde una sola máquina. Se detienen con Ctrl+C.
//
// Uso: pnpm --filter @sudoku-killer/web bots --code HPQ6NZ [--count 3] [--pace 4000]
//        [--errors 0.1] [--seed 1] [--url ws://127.0.0.1:8080/ws] [--origin http://localhost:5173]
import { parseArgs } from "node:util";
import { isRoomCodeShape } from "@sudoku-killer/protocol";
import WebSocket from "ws";
import { Bot } from "../src/dev/bot/bot.ts";
import { createWsTransport, type SocketLike } from "../src/transport/ws.ts";

const NAMES = ["Tomás", "Valeria", "Rafa", "Bruno", "Inés"];

const { values } = parseArgs({
  options: {
    code: { type: "string" },
    count: { type: "string", default: "2" },
    pace: { type: "string", default: "4000" },
    errors: { type: "string", default: "0.1" },
    seed: { type: "string", default: "1" },
    url: { type: "string", default: "ws://127.0.0.1:8080/ws" },
    origin: { type: "string", default: "http://localhost:5173" },
  },
});

const code = (values.code ?? "").toUpperCase();
if (!isRoomCodeShape(code)) {
  console.error("Falta --code con el código de la sala (6 caracteres), por ejemplo --code HPQ6NZ.");
  process.exit(1);
}
const count = Math.min(5, Math.max(1, Math.floor(Number(values.count))));
const pace = Math.max(200, Number(values.pace));
const errors = Math.min(1, Math.max(0, Number(values.errors)));
const seed = Math.floor(Number(values.seed));
const { url, origin } = values;

const bots = Array.from({ length: count }, (_, i) => {
  const transport = createWsTransport({
    url,
    open: (target) => new WebSocket(target, { origin }) as unknown as SocketLike,
    window: null,
    document: null,
  });
  transport.onStatus((status) => {
    if (status !== "open") console.info(`[bot ${String(i + 1)}] conexión: ${status}`);
  });
  return new Bot({
    transport,
    code,
    nickname: NAMES[i] ?? `Bot ${String(i + 1)}`,
    seed: seed + i,
    paceMs: pace,
    errorRate: errors,
    onNotice: (text) => {
      console.info(`[bot ${String(i + 1)}] ${text}`);
    },
  });
});

console.info(
  `${String(count)} bot(s) hacia ${url}, sala ${code}, ritmo ${String(pace)} ms, errores ${String(errors)}. Ctrl+C para salir.`,
);
process.on("SIGINT", () => {
  for (const bot of bots) bot.stop();
  process.exit(0);
});
