// Prueba de carga (F11e, SPEC §8.1): muchas salas simultáneas contra una instancia del servidor real
// sobre PostgreSQL (`DATABASE_URL`). Mide la latencia de una jugada (de enviar `cell.place` a recibir
// su respuesta, en el cliente) y la memoria y la CPU del proceso del servidor.
// - El servidor corre en un proceso hijo (`src/index.ts`, el mismo punto de entrada de `pnpm dev`),
//   y los clientes, en este proceso, con `ws`. Los dos comparten la máquina: la cifra no es la de
//   producción (se mide otra vez en F12, en el hosting).
// - Los parámetros están en `params.json` (versionados); los argumentos los reemplazan. El azar de
//   los clientes (ritmo, celdas, acciones) sale de la semilla; el puzzle de cada partida lo elige el
//   servidor con su propio azar.
// - Los clientes no reciben la solución: la calculan con el solver del motor sobre el puzzle
//   público, como en `demo`.
// - Al terminar una partida, quien inicia vuelve al lobby y empieza otra: la carga no decae.
// - `--reset-matches` vacía `matches` y `match_events` antes de empezar (para no reconstruir las
//   partidas de una corrida anterior). Solo se acepta con una base cuyo nombre termina en `_load`.
//
// Uso: pnpm --filter @sudoku-killer/server load --scenario realistic|stress [--rooms 50]
//        [--players 6] [--duration 60] [--warmup 15] [--seed N] [--port 8090] [--reset-matches]
//        [--out archivo.json] [--memory [--drain 130]]
// - `--memory` (F11f): el servidor corre con `--expose-gc` y el inspector de Node en 127.0.0.1, y el
//   script lee `process.memoryUsage()` del servidor por el protocolo del inspector: el heap base
//   (tras una recolección, sin salas), RSS y heap cada 10 s durante la medición, y, después de
//   cerrar todos los clientes y esperar `--drain` segundos a que se borren las salas (R-14, 120 s),
//   el heap tras forzar la recolección. Así se distingue una meseta de una fuga. Con
//   `--heap-snapshots carpeta`, guarda además una instantánea del heap al empezar (`base`) y otra al
//   final (`after`), para buscar qué queda retenido.
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { solveA } from "@sudoku-killer/engine";
import {
  parseServerEnvelope,
  type ClientMessageType,
  type PublicPuzzle,
  type ServerEnvelope,
} from "@sudoku-killer/protocol";
import pg from "pg";
import WebSocket from "ws";
import { WS_PATH } from "../../src/infra/ws-transport.ts";

const ORIGIN = "http://localhost:5173";

interface Scenario {
  readonly description: string;
  readonly minGapMs: number;
  readonly maxGapMs: number;
  readonly mix: { readonly correct: number; readonly wrong: number; readonly note: number };
}

interface Params {
  readonly version: number;
  readonly rooms: number;
  readonly playersPerRoom: number;
  readonly difficulty: "easy" | "medium" | "hard" | "expert";
  readonly warmupSeconds: number;
  readonly durationSeconds: number;
  readonly seed: number;
  readonly connectGapMs: number;
  readonly pingEveryMs: number;
  readonly restartAfterEndMs: number;
  readonly scenarios: Readonly<Record<string, Scenario>>;
}

const defaults = JSON.parse(
  readFileSync(new URL("params.json", import.meta.url), "utf8"),
) as Params;

const { values: args } = parseArgs({
  options: {
    scenario: { type: "string", default: "realistic" },
    rooms: { type: "string" },
    players: { type: "string" },
    duration: { type: "string" },
    warmup: { type: "string" },
    seed: { type: "string" },
    port: { type: "string", default: "8090" },
    "reset-matches": { type: "boolean", default: false },
    out: { type: "string" },
    memory: { type: "boolean", default: false },
    drain: { type: "string", default: "130" },
    "inspect-port": { type: "string", default: "9339" },
    "heap-snapshots": { type: "string" },
  },
});

const scenarioName = args.scenario;
const chosen = defaults.scenarios[scenarioName];
if (!chosen) throw new Error(`Unknown scenario ${scenarioName}`);
const scenario: Scenario = chosen;
const numberArg = (value: string | undefined, fallback: number) =>
  value === undefined ? fallback : Number(value);
const run = {
  scenario: scenarioName,
  rooms: numberArg(args.rooms, defaults.rooms),
  players: numberArg(args.players, defaults.playersPerRoom),
  durationSeconds: numberArg(args.duration, defaults.durationSeconds),
  warmupSeconds: numberArg(args.warmup, defaults.warmupSeconds),
  seed: numberArg(args.seed, defaults.seed),
  difficulty: defaults.difficulty,
  paramsVersion: defaults.version,
};
const port = Number(args.port);

const databaseUrl = process.env["DATABASE_URL"];
if (databaseUrl === undefined || databaseUrl === "") throw new Error("DATABASE_URL is not set");

/** mulberry32: todo el azar de los clientes sale de la semilla. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

// --- Base de datos ---

async function resetMatches(): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const name = (await client.query<{ db: string }>("SELECT current_database() AS db")).rows[0]
      ?.db;
    if (!name?.endsWith("_load")) throw new Error("--reset-matches needs a database named *_load");
    await client.query("TRUNCATE match_events, matches");
  } finally {
    await client.end();
  }
}

// --- Servidor ---

async function startServer(): Promise<ChildProcess> {
  const inspect = args.memory ? ["--expose-gc", `--inspect=127.0.0.1:${args["inspect-port"]}`] : [];
  const child = spawn(
    process.execPath,
    [
      ...inspect,
      "--conditions=@sudoku-killer/source",
      new URL("../../src/index.ts", import.meta.url).pathname,
    ],
    {
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        ALLOWED_ORIGINS: ORIGIN,
        LOG_LEVEL: "warn",
      },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  for (let i = 0; i < 150; i++) {
    await sleep(200);
    if (child.exitCode !== null) throw new Error("The server exited while starting");
    const open = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${String(port)}${WS_PATH}`, { origin: ORIGIN });
      ws.on("open", () => {
        ws.close();
        resolve(true);
      });
      ws.on("error", () => {
        resolve(false);
      });
    });
    if (open) return child;
  }
  throw new Error("The server did not start in 30 s");
}

/** Memoria residente (MB) y tiempo de CPU acumulado (s) del proceso del servidor, de /proc. */
function sample(pid: number): { rssMb: number; cpuSeconds: number } {
  const status = readFileSync(`/proc/${String(pid)}/status`, "utf8");
  const rssKb = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0);
  const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const ticks = Number(fields[11] ?? 0) + Number(fields[12] ?? 0);
  return { rssMb: rssKb / 1024, cpuSeconds: ticks / 100 };
}

interface Inspector {
  memory(gc: boolean): Promise<NodeJS.MemoryUsage>;
  snapshot(path: string): Promise<void>;
}

/** Una conexión al inspector del servidor, para leer su memoria y forzar la recolección. */
async function inspector(): Promise<Inspector> {
  const list = (await (
    await fetch(`http://127.0.0.1:${args["inspect-port"]}/json/list`)
  ).json()) as { webSocketDebuggerUrl: string }[];
  const url = list[0]?.webSocketDebuggerUrl;
  if (url === undefined) throw new Error("No inspector target");
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  let next = 1;
  const call = (method: string, params: object, onEvent?: (event: InspectorMessage) => void) =>
    new Promise<InspectorMessage>((resolve) => {
      const id = next++;
      const onMessage = (data: Buffer) => {
        const reply = JSON.parse(data.toString("utf8")) as InspectorMessage;
        if (reply.id === undefined) onEvent?.(reply);
        if (reply.id !== id) return;
        ws.off("message", onMessage);
        resolve(reply);
      };
      ws.on("message", onMessage);
      ws.send(JSON.stringify({ id, method, params }));
    });
  return {
    async memory(gc) {
      const expression = `(${gc ? "globalThis.gc(), globalThis.gc(), " : ""}JSON.stringify(process.memoryUsage()))`;
      const reply = await call("Runtime.evaluate", { expression, returnByValue: true });
      return JSON.parse(reply.result?.result?.value ?? "{}") as NodeJS.MemoryUsage;
    },
    async snapshot(path) {
      const chunks: string[] = [];
      await call("HeapProfiler.takeHeapSnapshot", { reportProgress: false }, (event) => {
        if (event.method === "HeapProfiler.addHeapSnapshotChunk")
          chunks.push(event.params?.chunk ?? "");
      });
      writeFileSync(path, chunks.join(""));
    },
  };
}

interface InspectorMessage {
  readonly id?: number;
  readonly method?: string;
  readonly params?: { readonly chunk?: string };
  readonly result?: { readonly result?: { readonly value?: string } };
}

const mb = (bytes: number) => round(bytes / 1024 / 1024);

/** Partidas sin terminar en la base (las salas borradas terminan las suyas con derrota). */
async function runningMatches(): Promise<number> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const rows = await client.query<{ n: string }>(
      "SELECT count(*) AS n FROM matches WHERE ended_at IS NULL",
    );
    return Number(rows.rows[0]?.n ?? 0);
  } finally {
    await client.end();
  }
}

// --- Medición ---

let measuring = false;
/** Desde cuándo se mide: solo cuentan las jugadas enviadas después. */
let measureFrom = Number.POSITIVE_INFINITY;
const latencies: number[] = [];
const outcomes = new Map<string, number>();
const count = (key: string) => outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
let sent = 0;
/** Comandos enviados durante la medición, por tipo (para el ritmo real por jugador). */
const sentMeasured = new Map<string, number>();
let received = 0;
let matchesStarted = 0;
let matchesEnded = 0;
const closes = new Map<number, number>();

const solutions = new Map<string, readonly number[]>();
function solutionOf(puzzle: PublicPuzzle): readonly number[] {
  let solution = solutions.get(puzzle.id);
  if (!solution) {
    solution = solveA(puzzle, { limit: 1 }).solutions[0];
    if (!solution) throw new Error("The public puzzle has no solution");
    solutions.set(puzzle.id, solution);
  }
  return solution;
}

// --- Clientes ---

class LoadClient {
  readonly ws: WebSocket;
  playerId: string | null = null;
  code: string | null = null;
  starter = false;
  lives = 3;
  running = false;
  puzzle: PublicPuzzle | null = null;
  locked = new Set<number>();
  private nextId = 1;
  private readonly prefix: string;
  private readonly waiting = new Map<string, (message: ServerEnvelope) => void>();
  private readonly placed = new Map<string, number>();
  private readonly onMessage: (client: LoadClient, message: ServerEnvelope) => void;

  constructor(name: string, onMessage: (client: LoadClient, message: ServerEnvelope) => void) {
    this.prefix = name;
    this.onMessage = onMessage;
    this.ws = new WebSocket(`ws://127.0.0.1:${String(port)}${WS_PATH}`, { origin: ORIGIN });
    this.ws.on("message", (data) => {
      received++;
      const text = (data as Buffer).toString("utf8");
      const parsed = parseServerEnvelope(JSON.parse(text) as unknown);
      if (!parsed.ok) throw new Error(`Invalid message: ${text}`);
      const message = parsed.message;
      if (message.replyTo !== undefined) {
        const at = this.placed.get(message.replyTo);
        if (at !== undefined) {
          this.placed.delete(message.replyTo);
          if (measuring && at >= measureFrom) {
            latencies.push(performance.now() - at);
            count(message.type === "error" ? `error:${message.payload.code}` : message.type);
          }
        }
        const resolve = this.waiting.get(message.replyTo);
        if (resolve) {
          this.waiting.delete(message.replyTo);
          resolve(message);
        }
      }
      this.onMessage(this, message);
    });
    this.ws.on("close", (code) => {
      closes.set(code, (closes.get(code) ?? 0) + 1);
    });
  }

  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once("open", () => {
        resolve();
      });
      this.ws.once("error", reject);
    });
  }

  send(type: ClientMessageType, payload: object): string {
    const id = `${this.prefix}-${String(this.nextId++)}`;
    if (type === "cell.place") this.placed.set(id, performance.now());
    sent++;
    if (measuring) sentMeasured.set(type, (sentMeasured.get(type) ?? 0) + 1);
    this.ws.send(JSON.stringify({ v: 1, id, type, payload }));
    return id;
  }

  /** Envía y espera la primera respuesta con su `replyTo` (o `undefined` a los 10 s). */
  request(type: ClientMessageType, payload: object): Promise<ServerEnvelope | undefined> {
    const id = this.send(type, payload);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        count(`timeout:${type}`);
        resolve(undefined);
      }, 10_000);
      this.waiting.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }

  close(): void {
    this.ws.close(1000, "load over");
  }
}

function welcomeOf(message: ServerEnvelope | undefined) {
  if (message?.type !== "room.welcome")
    throw new Error(`Expected room.welcome: ${message?.type ?? "nothing"}`);
  return message.payload;
}

/** Lo que cada cliente aprende de los mensajes de su sala. */
function onMessage(client: LoadClient, message: ServerEnvelope): void {
  switch (message.type) {
    case "match.started":
      client.puzzle = message.payload.puzzle;
      client.locked = new Set(message.payload.puzzle.givens.map((g) => g.cell));
      client.lives = 3;
      client.running = true;
      if (client.starter) matchesStarted++;
      break;
    case "cell.solved":
    case "hint.used":
      client.locked.add(message.payload.cell);
      break;
    case "cell.mistake":
      if (message.payload.by === client.playerId) client.lives = message.payload.livesLeft;
      break;
    case "match.ended":
      client.running = false;
      if (client.starter) {
        matchesEnded++;
        setTimeout(() => {
          void restart(client);
        }, defaultsRestartMs);
      }
      break;
    default:
      break;
  }
}
const defaultsRestartMs = defaults.restartAfterEndMs;

async function restart(starter: LoadClient): Promise<void> {
  if (stopped()) return;
  await starter.request("room.reset", {});
  await starter.request("room.set_difficulty", { difficulty: run.difficulty });
  await starter.request("match.start", {});
}

let stopping = false;
/** Se lee en cada vuelta: otra tarea lo cambia mientras el bucle espera. */
const stopped = () => stopping;

/** El bucle de un jugador: una acción cada `minGapMs`–`maxGapMs`. */
async function play(client: LoadClient, seedOffset: number): Promise<void> {
  const own = rng(run.seed + seedOffset);
  const gap = () => scenario.minGapMs + own() * (scenario.maxGapMs - scenario.minGapMs);
  let lastPing = 0;
  await sleep(own() * scenario.maxGapMs);
  while (!stopped()) {
    await sleep(gap());
    if (stopped()) break;
    const now = performance.now();
    if (now - lastPing >= defaults.pingEveryMs) {
      lastPing = now;
      client.send("sys.ping", { t0: Date.now() });
    }
    const puzzle = client.puzzle;
    if (!client.running || !puzzle || client.lives === 0) continue;
    const empty: number[] = [];
    for (let i = 0; i < puzzle.size * puzzle.size; i++) if (!client.locked.has(i)) empty.push(i);
    const cell = empty[Math.floor(own() * empty.length)];
    if (cell === undefined) continue;
    const solution = solutionOf(puzzle);
    const answer = solution[cell] ?? 1;
    client.send("presence.select", { cell });
    const roll = own();
    const { correct, wrong } = scenario.mix;
    if (roll < correct) client.send("cell.place", { cell, digit: answer });
    else if (roll < correct + wrong && client.lives > 1)
      client.send("cell.place", { cell, digit: (answer % 9) + 1 });
    else
      client.send(own() < 0.5 ? "note.add" : "note.remove", {
        layer: own() < 0.5 ? "personal" : "group",
        cell,
        digit: 1 + Math.floor(own() * 9),
      });
  }
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;
}

const round = (value: number, digits = 1) => Number(value.toFixed(digits));

// --- Corrida ---

if (args["reset-matches"]) await resetMatches();
const server = await startServer();
const pid = server.pid;
if (pid === undefined) throw new Error("No server pid");
const idle = sample(pid);
const probe = args.memory ? await inspector() : null;
const memory = probe ? (gc: boolean) => probe.memory(gc) : null;
const baseHeap = memory ? await memory(true) : null;
const snapshots = args["heap-snapshots"];
if (probe && snapshots !== undefined) await probe.snapshot(`${snapshots}/base.heapsnapshot`);
const loop = monitorEventLoopDelay({ resolution: 10 });

const clients: LoadClient[] = [];
const loops: Promise<void>[] = [];
try {
  for (let r = 0; r < run.rooms; r++) {
    const creator = new LoadClient(`r${String(r)}p0`, onMessage);
    creator.starter = true;
    await creator.opened();
    const welcome = welcomeOf(await creator.request("room.create", { nickname: "Jugador 0" }));
    creator.playerId = welcome.playerId;
    const code = welcome.snapshot.room.code;
    creator.code = code;
    clients.push(creator);
    for (let p = 1; p < run.players; p++) {
      const client = new LoadClient(`r${String(r)}p${String(p)}`, onMessage);
      await client.opened();
      const joined = welcomeOf(
        await client.request("room.join", { code, nickname: `Jugador ${String(p)}` }),
      );
      client.playerId = joined.playerId;
      client.code = code;
      clients.push(client);
    }
    await creator.request("room.set_difficulty", { difficulty: run.difficulty });
    await creator.request("match.start", {});
    await sleep(defaults.connectGapMs);
  }
  clients.forEach((client, i) => loops.push(play(client, i + 1)));

  await sleep(run.warmupSeconds * 1000);
  const start = sample(pid);
  const startedAt = performance.now();
  measuring = true;
  measureFrom = performance.now();
  loop.enable();
  const rss: number[] = [];
  const cpu: number[] = [];
  const timeline: { s: number; rssMb: number; heapUsedMb: number }[] = [];
  const generatorCpuStart = process.cpuUsage();
  let previous = start;
  for (let s = 0; s < run.durationSeconds; s++) {
    await sleep(1000);
    const now = sample(pid);
    rss.push(now.rssMb);
    cpu.push((now.cpuSeconds - previous.cpuSeconds) * 100);
    previous = now;
    if (memory && (s + 1) % 10 === 0)
      timeline.push({
        s: s + 1,
        rssMb: round(now.rssMb),
        heapUsedMb: mb((await memory(false)).heapUsed),
      });
  }
  const generatorCpu = process.cpuUsage(generatorCpuStart);
  measuring = false;
  loop.disable();
  const elapsed = (performance.now() - startedAt) / 1000;
  let drained: object | undefined;
  if (memory && baseHeap) {
    stopping = true;
    await Promise.allSettled(loops);
    for (const client of clients) client.close();
    await sleep(Number(args.drain) * 1000);
    const after = await memory(true);
    if (probe && snapshots !== undefined) await probe.snapshot(`${snapshots}/after.heapsnapshot`);
    drained = {
      waitedSeconds: Number(args.drain),
      runningMatchesInDb: await runningMatches(),
      baseHeapUsedMb: mb(baseHeap.heapUsed),
      heapUsedAfterGcMb: mb(after.heapUsed),
      rssAfterMb: round(sample(pid).rssMb),
      baseRssMb: round(idle.rssMb),
    };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const result = {
    run,
    machine: { cpus: (await import("node:os")).cpus().length, node: process.version },
    connections: clients.filter((c) => c.ws.readyState === WebSocket.OPEN).length,
    placeLatencyMs: {
      count: sorted.length,
      p50: round(percentile(sorted, 50)),
      p95: round(percentile(sorted, 95)),
      p99: round(percentile(sorted, 99)),
      max: round(sorted.at(-1) ?? Number.NaN),
    },
    placesPerSecond: round(sorted.length / elapsed),
    outcomes: Object.fromEntries([...outcomes].sort()),
    serverMemoryMb: {
      idle: round(idle.rssMb),
      atStart: round(start.rssMb),
      peak: round(Math.max(...rss)),
      atEnd: round(rss.at(-1) ?? Number.NaN),
    },
    serverCpuPercent: {
      mean: round(cpu.reduce((a, b) => a + b, 0) / Math.max(1, cpu.length)),
      peak: round(Math.max(...cpu)),
    },
    generatorCpuPercent: round(((generatorCpu.user + generatorCpu.system) / 1e6 / elapsed) * 100),
    perPlayerPerSecond: Object.fromEntries(
      [...sentMeasured]
        .sort()
        .map(([type, n]) => [type, round(n / elapsed / (run.rooms * run.players), 2)]),
    ),
    ...(memory ? { memoryTimeline: timeline, drained } : {}),
    generatorLoopDelayMs: {
      p95: round(loop.percentile(95) / 1e6),
      max: round(loop.max / 1e6),
    },
    messages: { sent, received },
    matches: { started: matchesStarted, ended: matchesEnded },
    closes: Object.fromEntries(closes),
  };
  console.log(JSON.stringify(result, null, 2));
  if (args.out !== undefined) writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`);
} finally {
  stopping = true;
  await Promise.allSettled(loops);
  for (const client of clients) client.close();
  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));
}
