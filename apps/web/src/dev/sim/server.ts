// Servidor simulado en memoria (solo desarrollo, F8): una sala mínima que habla el protocolo v1 real,
// con los mismos esquemas Zod y el mismo reductor que usará el servidor de F9 (`@sudoku-killer/game`).
// Las salas completas (fichas, plazos de gracia, cola con idempotencia) son de F9: aquí hay lo justo
// para jugar una partida con uno o varios clientes (el bot de F8f entra con `room.join`).
import {
  GAME_COMMAND_TYPES,
  applyWithEffects,
  createNormalMode,
  decide,
  decideConnection,
  decideJoin,
  decideStarter,
  fanOut,
  initialState,
  messagesOf,
  publicPlayers,
  snapshotFor,
  startMatch,
  type Decision,
  type MatchState,
  type Outgoing,
  type PlayerEntry,
  type RoomView,
} from "@sudoku-killer/game";
import {
  parseClientEnvelope,
  serverEnvelopeSchema,
  type ClientEnvelope,
  type Connection,
  type Difficulty,
  type ErrorCode,
  type PublicPlayer,
  type PublicPuzzle,
  type RoomState,
  type ServerEnvelope,
  type Settings,
  type Snapshot,
} from "@sudoku-killer/protocol";
import { PARAMS_V1 } from "@sudoku-killer/scoring";

export const SIM_MODE = createNormalMode(PARAMS_V1);

/** Alfabeto de los códigos de sala (D2). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const PRESENCE_WINDOW_MS = 100;

export interface SimPuzzle {
  readonly puzzle: PublicPuzzle;
  readonly solution: readonly number[];
}

export interface SimServerOptions {
  /** Hora del servidor simulado (puede tener un desfase respecto del cliente, T-07.2). */
  readonly now: () => number;
  readonly loadPuzzle: (difficulty: Difficulty) => Promise<SimPuzzle>;
  /** Identificadores opacos (jugadores, partidas y fichas). */
  readonly randomId: () => string;
  /** Un entero en `0..bound − 1`, para el código de sala. */
  readonly randomInt: (bound: number) => number;
}

interface Member {
  readonly id: string;
  readonly nickname: string;
  readonly nicknameKey: string;
  seat: number | null;
  readonly joinedAt: number;
  connection: Connection;
  settings: Settings;
  readonly tokenHash: string;
  link: number | null;
}

interface Room {
  readonly code: string;
  state: RoomState;
  starterId: string | null;
  difficulty: Difficulty;
  readonly members: Map<string, Member>;
  match: { state: MatchState; readonly solution: readonly number[] } | null;
}

export interface SimConnection {
  /** Un mensaje de texto del cliente. */
  receive(text: string): void;
  /** El cliente cerró la conexión. */
  close(): void;
}

const nicknameKeyOf = (nickname: string) => nickname.normalize("NFKC").trim().toLowerCase();

export class SimServer {
  private room: Room | null = null;
  private readonly links = new Map<
    number,
    { deliver: (text: string) => void; playerId: string | null }
  >();
  private nextLink = 1;
  private queue: Promise<void> = Promise.resolve();
  private readonly presence = new Map<
    string,
    { cell: number | null; open: boolean; sent: number | null }
  >();
  private readonly options: SimServerOptions;

  constructor(options: SimServerOptions) {
    this.options = options;
  }

  /** Abre una conexión: `deliver` recibe cada mensaje del servidor como texto. */
  connect(deliver: (text: string) => void): SimConnection {
    const link = this.nextLink++;
    this.links.set(link, { deliver, playerId: null });
    return {
      receive: (text) => {
        // Una cola, como la de cada sala (SPEC §4.6): los comandos se procesan uno por uno.
        this.queue = this.queue
          .then(() => this.handle(link, text))
          .catch((error: unknown) => {
            console.error("[sim]", error);
          });
      },
      close: () => {
        this.queue = this.queue.then(() => {
          this.disconnect(link);
        });
      },
    };
  }

  /** Espera a que se procesen los comandos recibidos (para las pruebas). */
  settled(): Promise<void> {
    return this.queue;
  }

  // --- Envío ---

  private send(link: number, envelope: ServerEnvelope): void {
    // En desarrollo se valida todo lo que sale: un error aquí es un error del simulador.
    const checked = serverEnvelopeSchema.parse(envelope);
    this.links.get(link)?.deliver(JSON.stringify(checked));
  }

  private reply(
    link: number,
    request: ClientEnvelope | null,
    body: Pick<ServerEnvelope, "type" | "payload">,
  ): void {
    this.send(link, {
      v: 1,
      ...body,
      ...(request ? { replyTo: request.id } : {}),
    } as ServerEnvelope);
  }

  private error(
    link: number,
    request: ClientEnvelope | null,
    code: ErrorCode,
    reason?: string,
  ): void {
    this.reply(link, request, {
      type: "error",
      payload: reason === undefined ? { code } : { code, reason },
    });
  }

  private linkOf(playerId: string): number | null {
    return this.room?.members.get(playerId)?.link ?? null;
  }

  private connectedIds(): string[] {
    return [...(this.room?.members.values() ?? [])].flatMap((m) => (m.link === null ? [] : [m.id]));
  }

  private deliverAll(
    messages: readonly Outgoing[],
    author?: { playerId: string; clientMsgId: string },
  ): void {
    for (const { to, envelope } of fanOut(messages, this.connectedIds(), author)) {
      const link = this.linkOf(to);
      if (link !== null) this.send(link, envelope);
    }
  }

  private broadcast(type: Outgoing["type"], payload: Outgoing["payload"], except?: string): void {
    const audience =
      except === undefined
        ? { kind: "all" as const }
        : { kind: "except" as const, playerId: except };
    this.deliverAll([{ audience, type, payload } as Outgoing]);
  }

  // --- Partida ---

  /** Aplica una decisión sobre la partida y difunde sus mensajes. Devuelve si hubo eventos. */
  private commit(
    decision: Decision,
    link: number | null,
    request: ClientEnvelope | null,
    playerId?: string,
  ): boolean {
    const room = this.room;
    if (!decision.ok) {
      if (link !== null) this.reply(link, request, decision.reply);
      return false;
    }
    const match = room?.match;
    if (!room || !match) return false;
    for (const event of decision.events) {
      const { state, effects } = applyWithEffects(match.state, event, {
        mode: SIM_MODE,
        puzzle: match.state.puzzle,
      });
      match.state = state;
      const author =
        playerId !== undefined && request ? { playerId, clientMsgId: request.id } : undefined;
      this.deliverAll(messagesOf(event, state, effects, SIM_MODE), author);
      if (event.type === "match.ended") {
        room.state = "finished";
        this.broadcast("room.state_changed", { state: "finished" });
      }
    }
    return true;
  }

  private roomView(room: Room): RoomView {
    return {
      code: room.code,
      state: room.state,
      starterId: room.starterId,
      difficulty: room.difficulty,
      players: this.publicPlayersOf(room),
    };
  }

  private publicPlayersOf(room: Room): PublicPlayer[] {
    if (room.match && room.state !== "waiting") return publicPlayers(room.match.state);
    return [...room.members.values()].map((m) => ({
      id: m.id,
      nickname: m.nickname,
      seat: m.seat,
      joinedAt: m.joinedAt,
      connection: m.connection,
      role: null,
      lives: 0,
      score: 0,
      mistakes: 0,
    }));
  }

  private snapshot(room: Room, member: Member): Snapshot {
    const now = this.options.now();
    if (room.match && room.state !== "waiting") {
      return snapshotFor(room.match.state, this.roomView(room), member.id, now, SIM_MODE);
    }
    return {
      serverNow: now,
      atSeq: null,
      room: { ...this.roomView(room), players: this.publicPlayersOf(room) },
      match: null,
      you: { playerId: member.id, settings: member.settings, personalNotes: [] },
    };
  }

  private entryOf(member: Member): PlayerEntry {
    return {
      playerId: member.id,
      nickname: member.nickname,
      seat: member.seat,
      joinedAt: member.joinedAt,
      tokenHash: member.tokenHash,
      connection: member.connection,
      autoCleanPersonalNotes: member.settings.autoCleanPersonalNotes,
    };
  }

  // --- Comandos ---

  private async handle(link: number, text: string): Promise<void> {
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      this.error(link, null, "bad_request");
      return;
    }
    const parsed = parseClientEnvelope(input);
    if (!parsed.ok) {
      this.error(link, null, parsed.code);
      return;
    }
    const message = parsed.message;
    const playerId = this.links.get(link)?.playerId ?? null;

    if (message.type === "sys.ping") {
      this.reply(link, null, {
        type: "sys.pong",
        payload: { t0: message.payload.t0, serverNow: this.options.now() },
      });
      return;
    }
    if (message.type === "room.create" || message.type === "room.join") {
      if (playerId !== null) {
        this.error(link, message, "room.wrong_state");
        return;
      }
      this.enter(link, message);
      return;
    }
    const room = this.room;
    const member = playerId === null ? undefined : room?.members.get(playerId);
    if (!room || !member) {
      this.error(link, message, "room.not_found");
      return;
    }
    switch (message.type) {
      case "room.leave":
        this.leave(room, member, link, message);
        return;
      case "room.set_difficulty":
        if (room.starterId !== member.id) {
          this.error(link, message, "forbidden");
          return;
        }
        if (room.state !== "waiting") {
          this.error(link, message, "room.wrong_state");
          return;
        }
        room.difficulty = message.payload.difficulty;
        this.broadcast("room.difficulty_set", { difficulty: room.difficulty });
        return;
      case "match.start":
        if (room.starterId !== member.id) {
          this.error(link, message, "forbidden");
          return;
        }
        if (room.state !== "waiting") {
          this.error(link, message, "room.wrong_state");
          return;
        }
        await this.start(room);
        return;
      case "room.reset":
        if (room.starterId !== member.id) {
          this.error(link, message, "forbidden");
          return;
        }
        if (room.state !== "finished") {
          this.error(link, message, "room.wrong_state");
          return;
        }
        room.state = "waiting";
        room.match = null;
        this.broadcast("room.state_changed", { state: "waiting" });
        return;
      case "presence.select":
        if (room.state === "running") this.select(member.id, message.payload.cell);
        return;
      case "settings.update":
        member.settings = { autoCleanPersonalNotes: message.payload.autoCleanPersonalNotes };
        if (room.state === "running" && room.match?.state.players.has(member.id)) break;
        this.reply(link, message, { type: "ack", payload: { applied: true } });
        return;
      default:
        break;
    }
    if (!(GAME_COMMAND_TYPES as readonly string[]).includes(message.type)) {
      this.error(link, message, "bad_request");
      return;
    }
    const match = room.match;
    if (room.state !== "running" || !match) {
      this.error(link, message, "match.not_running");
      return;
    }
    const decision = decide(match.state, member.id, message, {
      mode: SIM_MODE,
      solution: match.solution,
      at: this.options.now(),
    });
    this.commit(decision, link, message, member.id);
  }

  private enter(
    link: number,
    message: ClientEnvelope & { type: "room.create" | "room.join" },
  ): void {
    const nickname = message.payload.nickname.normalize("NFKC").trim();
    if (nickname.length < 2 || nickname.length > 16) {
      this.error(link, message, "nickname.invalid");
      return;
    }
    const now = this.options.now();
    if (message.type === "room.create") {
      // Una sola sala: crear otra reemplaza la anterior.
      const code = Array.from(
        { length: 6 },
        () => CODE_ALPHABET[this.options.randomInt(CODE_ALPHABET.length)],
      ).join("");
      this.room = {
        code,
        state: "waiting",
        starterId: null,
        difficulty: "easy",
        members: new Map(),
        match: null,
      };
    }
    const room = this.room;
    if (
      !room ||
      (message.type === "room.join" && message.payload.code.toUpperCase() !== room.code)
    ) {
      this.error(link, message, "room.not_found");
      return;
    }
    const members = [...room.members.values()];
    const taken = new Set(members.flatMap((m) => (m.seat === null ? [] : [m.seat])));
    const seat = [0, 1, 2, 3, 4, 5].find((s) => !taken.has(s));
    if (seat === undefined) {
      this.error(link, message, "room.full");
      return;
    }
    const nicknameKey = nicknameKeyOf(nickname);
    if (members.some((m) => m.nicknameKey === nicknameKey)) {
      this.error(link, message, "nickname.taken");
      return;
    }
    const token = this.options.randomId();
    const member: Member = {
      id: this.options.randomId(),
      nickname,
      nicknameKey,
      seat,
      joinedAt: now,
      connection: "connected",
      settings: { autoCleanPersonalNotes: true },
      tokenHash: `sim:${token}`,
      link,
    };
    room.members.set(member.id, member);
    const linked = this.links.get(link);
    if (linked) linked.playerId = member.id;
    room.starterId ??= member.id;

    if (room.state === "running" && room.match) {
      this.commit(decideJoin(room.match.state, this.entryOf(member), SIM_MODE, now), null, null);
    } else {
      const [player] = this.publicPlayersOf({ ...room, members: new Map([[member.id, member]]) });
      if (player) this.broadcast("room.player_joined", { player }, member.id);
    }
    this.reply(link, message, {
      type: "room.welcome",
      payload: { playerId: member.id, token, snapshot: this.snapshot(room, member) },
    });
  }

  private async start(room: Room): Promise<void> {
    const { puzzle, solution } = await this.options.loadPuzzle(room.difficulty);
    const at = this.options.now();
    const players = [...room.members.values()]
      .filter((m) => m.seat !== null)
      .map((m) => this.entryOf(m));
    const started = startMatch({
      matchId: this.options.randomId(),
      puzzle,
      difficulty: room.difficulty,
      starterId: room.starterId,
      players,
      mode: SIM_MODE,
      at,
    });
    const state = initialState(started, { mode: SIM_MODE, puzzle });
    room.match = { state, solution };
    room.state = "running";
    this.broadcast("room.state_changed", { state: "running" });
    this.broadcast("match.started", {
      matchId: state.id,
      puzzle,
      startedAt: state.startedAt,
      hintsLeft: state.hintsLeft,
      players: publicPlayers(state),
    });
  }

  private leave(room: Room, member: Member, link: number, message: ClientEnvelope): void {
    const at = this.options.now();
    member.connection = "left";
    member.seat = null;
    this.reply(link, message, { type: "ack", payload: { applied: true } });
    member.link = null;
    const linked = this.links.get(link);
    if (linked) linked.playerId = null;
    const match = room.match;
    if (room.state === "running" && match?.state.players.has(member.id)) {
      this.commit(
        decideConnection(
          match.state,
          { playerId: member.id, connection: "left", seat: null },
          SIM_MODE,
          at,
        ),
        null,
        null,
      );
    } else {
      room.members.delete(member.id);
      this.broadcast("room.player_removed", { playerId: member.id });
    }
    if (room.starterId === member.id) this.passStarter(room, at);
  }

  /** El derecho de iniciar pasa al jugador con asiento más antiguo (R-11). */
  private passStarter(room: Room, at: number): void {
    const next = [...room.members.values()]
      .filter((m) => m.seat !== null)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    room.starterId = next?.id ?? null;
    const match = room.match;
    if (room.state === "running" && match) {
      this.commit(decideStarter(match.state, room.starterId, at), null, null);
    } else {
      this.broadcast("room.starter_changed", { playerId: room.starterId });
    }
  }

  private disconnect(link: number): void {
    const playerId = this.links.get(link)?.playerId ?? null;
    this.links.delete(link);
    const room = this.room;
    const member = playerId === null ? undefined : room?.members.get(playerId);
    if (!room || !member) return;
    member.link = null;
    member.connection = "disconnected";
    const match = room.match;
    if (room.state === "running" && match?.state.players.has(member.id)) {
      this.commit(
        decideConnection(
          match.state,
          { playerId: member.id, connection: "disconnected", seat: member.seat },
          SIM_MODE,
          this.options.now(),
        ),
        null,
        null,
      );
    } else {
      this.broadcast("room.player_connection", {
        playerId: member.id,
        connection: "disconnected",
        seat: member.seat,
      });
    }
  }

  /** Presencia agrupada: como máximo una difusión cada 100 ms por jugador, con la última (§4.8). */
  private select(playerId: string, cell: number | null): void {
    const entry = this.presence.get(playerId) ?? { cell: null, open: false, sent: null };
    entry.cell = cell;
    this.presence.set(playerId, entry);
    if (entry.open) return;
    const flush = () => {
      if (entry.sent !== entry.cell) {
        entry.sent = entry.cell;
        this.broadcast("presence.updated", { playerId, cell: entry.cell }, playerId);
        entry.open = true;
        setTimeout(() => {
          entry.open = false;
          if (entry.sent !== entry.cell) flush();
        }, PRESENCE_WINDOW_MS);
      }
    };
    flush();
  }
}
