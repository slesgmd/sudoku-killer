// Demostración: levanta el servidor real (WebSocket en /ws, registro con group commit) y dos
// clientes Node, Ana y Bea, juegan una partida completa hasta la victoria.
// - Los clientes nunca reciben la solución: la calculan con el solver del motor sobre el puzzle
//   público, como podría hacerlo cualquier cliente (el puzzle tiene solución única).
// - Cada mensaje recibido se valida con los esquemas del protocolo.
// - Hay una nota grupal, un error y una pista, y al final se imprime el ranking.
// Usa la base de `DATABASE_URL` (apps/server/.env) si existe; si no, o con `--pglite`, PGlite en
// memoria con un puzzle por dificultad.
//
// Uso: pnpm --filter @sudoku-killer/server demo [--pglite]
import { solveA } from "@sudoku-killer/engine";
import {
  parseServerEnvelope,
  type ClientMessageType,
  type ServerEnvelope,
} from "@sudoku-killer/protocol";
import WebSocket from "ws";
import { startApp } from "../src/app.ts";
import { connect, migrateDatabase } from "../src/db/connect.ts";
import type { Database } from "../src/db/database.ts";
import { WS_PATH } from "../src/infra/ws-transport.ts";
import { createLogger } from "../src/log/logger.ts";

const ORIGIN = "http://localhost:5173";
/** Entre jugada y jugada de cada cliente: por debajo del límite de 20 comandos por segundo. */
const PACE_MS = 70;

async function database(): Promise<{ db: Database; close: () => Promise<void>; kind: string }> {
  const url = process.env["DATABASE_URL"];
  if (url !== undefined && url !== "" && !process.argv.includes("--pglite")) {
    const connection = connect(url);
    await migrateDatabase(connection.db);
    return {
      db: connection.db,
      close: () => connection.close(),
      kind: "PostgreSQL (DATABASE_URL)",
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const { readFileSync } = await import("node:fs");
  const { manifestSchema } = await import("@sudoku-killer/bank");
  const { loadBank } = await import("../src/puzzles/load-bank.ts");
  const schema = await import("../src/db/schema.ts");
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, {
    migrationsFolder: new URL("../drizzle", import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      "$1",
    ),
  });
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(new URL("../bank/manifest.json", import.meta.url), "utf8")),
  );
  const seen = new Set<string>();
  const entries = manifest.entries.filter((e) => !seen.has(e.difficulty) && seen.add(e.difficulty));
  await loadBank(db, { ...manifest, entries });
  return { db, close: () => client.close(), kind: "PGlite en memoria" };
}

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

class Player {
  readonly name: string;
  readonly messages: ServerEnvelope[] = [];
  validated = 0;
  playerId = "";
  private readonly ws: WebSocket;
  private readonly waiters: { type: string; done: (m: ServerEnvelope) => void }[] = [];
  private next = 0;

  constructor(name: string, port: number) {
    this.name = name;
    this.ws = new WebSocket(`ws://127.0.0.1:${String(port)}${WS_PATH}`, { origin: ORIGIN });
    this.ws.on("message", (data) => {
      const parsed = parseServerEnvelope(JSON.parse((data as Buffer).toString("utf8")) as unknown);
      if (!parsed.ok) throw new Error(`${name} received an invalid message`);
      this.validated++;
      const message = parsed.message;
      this.messages.push(message);
      for (const waiter of [...this.waiters]) {
        if (waiter.type === message.type) {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.done(message);
        }
      }
    });
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once("open", () => {
        resolve();
      });
      this.ws.once("error", reject);
    });
  }

  send(type: ClientMessageType, payload: unknown): void {
    this.ws.send(
      JSON.stringify({ v: 1, id: `${this.name}-${String(++this.next)}`, type, payload }),
    );
  }

  /** El próximo mensaje de ese tipo (o el que ya llegó y nadie esperó). */
  wait<T extends ServerEnvelope["type"]>(type: T): Promise<Extract<ServerEnvelope, { type: T }>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${this.name}: no ${type} in 10 s`));
      }, 10_000);
      this.waiters.push({
        type,
        done: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerEnvelope, { type: T }>);
        },
      });
    });
  }

  close(): void {
    this.ws.close(1000, "demo over");
  }
}

const { db, close, kind } = await database();
const app = await startApp({
  db,
  host: "127.0.0.1",
  port: 0,
  allowedOrigins: [ORIGIN],
  logger: createLogger({ level: "warn" }),
});
console.log(`Servidor real en ws://127.0.0.1:${String(app.port)}${WS_PATH} (base: ${kind}).`);

const ana = new Player("Ana", app.port);
const bea = new Player("Bea", app.port);
await Promise.all([ana.open(), bea.open()]);

const created = ana.wait("room.welcome");
ana.send("room.create", { nickname: "Ana" });
const welcome = await created;
ana.playerId = welcome.payload.playerId;
const code = welcome.payload.snapshot.room.code;
console.log(`Ana creó la sala ${code}.`);
const joined = bea.wait("room.welcome");
bea.send("room.join", { code, nickname: "Bea" });
bea.playerId = (await joined).payload.playerId;
console.log("Bea entró a la sala.");

const started = bea.wait("match.started");
ana.send("match.start", {});
const { puzzle } = (await started).payload;
console.log(
  `Empieza la partida: ${puzzle.difficulty}, ${String(puzzle.givens.length)} números iniciales.`,
);

// Los clientes resuelven el puzzle público por su cuenta: el servidor nunca envía la solución.
const solved = solveA(puzzle, { limit: 1 }).solutions[0];
if (!solved) throw new Error("The public puzzle has no solution");
const locked = new Set(puzzle.givens.map((g) => g.cell));
const empty = solved.map((_, cell) => cell).filter((cell) => !locked.has(cell));

const [noteCell, mistakeCell, hintCell] = empty;
if (noteCell === undefined || mistakeCell === undefined || hintCell === undefined) {
  throw new Error("Too few empty cells");
}
const noted = bea.wait("note.applied");
ana.send("note.add", { layer: "group", cell: noteCell, digit: solved[noteCell] ?? 1 });
console.log(
  `Ana anota el ${String(solved[noteCell])} en la celda ${String(noteCell)} (nota grupal); Bea la ve.`,
);
await noted;
const mistake = ana.wait("cell.mistake");
bea.send("cell.place", { cell: mistakeCell, digit: ((solved[mistakeCell] ?? 1) % 9) + 1 });
const missed = (await mistake).payload;
console.log(
  `Bea se equivoca en la celda ${String(missed.cell)}: ${String(missed.points)} puntos, le quedan ${String(missed.livesLeft)} vidas.`,
);
const hinted = ana.wait("hint.used");
bea.send("hint.use", { cell: hintCell });
console.log(
  `Bea usa una pista: celda ${String(hintCell)} = ${String((await hinted).payload.value)}.`,
);

const ended = ana.wait("match.ended");
const rest = empty.filter((cell) => cell !== hintCell);
for (const [i, cell] of rest.entries()) {
  const player = i % 2 === 0 ? ana : bea;
  player.send("cell.place", { cell, digit: solved[cell] });
  await sleep(PACE_MS / 2);
}
const result = (await ended).payload;
await sleep(100);
const names = new Map([
  [ana.playerId, "Ana"],
  [bea.playerId, "Bea"],
]);
console.log(`\nResultado: ${result.result === "victory" ? "victoria" : "derrota"}.`);
for (const entry of result.ranking) {
  console.log(
    `  ${String(entry.position)}. ${names.get(entry.playerId) ?? entry.nickname}: ${String(entry.score)} puntos, ${String(entry.mistakes)} ${entry.mistakes === 1 ? "error" : "errores"}`,
  );
}
const solvedBy = (p: Player) => p.messages.filter((m) => m.type === "cell.solved").length;
console.log(
  `Mensajes validados con Zod: Ana ${String(ana.validated)}, Bea ${String(bea.validated)}; cell.solved vistos: ${String(solvedBy(ana))} y ${String(solvedBy(bea))}.`,
);

ana.close();
bea.close();
await app.stop();
await close();
process.exitCode = result.result === "victory" ? 0 : 1;
