// Una sala (SPEC §2.3 y §3): su estado en memoria, la cola que procesa sus comandos de a uno (§4.6)
// y la bandeja de salida, que entrega cada mensaje recién cuando están confirmados en la base de datos
// los eventos anteriores (ADR 0004). Las reglas de la partida son las de `@sudoku-killer/game`
// (`decide`, el reductor y la proyección), sin reescribirlas aquí.
import {
  applyWithEffects,
  decide,
  decideConnection,
  decideJoin,
  decideStarter,
  fanOut,
  freeSeat,
  holdsSeat,
  initialState,
  lobbyPlayer,
  lobbySnapshot,
  messagesOf,
  nextStarter,
  publicPlayer,
  publicPlayers,
  seatFor,
  snapshotFor,
  startMatch,
  type Decision,
  type GameMode,
  type MatchEvent,
  type MatchState,
  type Outgoing,
  type PlayerEntry,
  type RoomView,
} from "@sudoku-killer/game";
import type { Rng } from "@sudoku-killer/engine";
import {
  CLOSE_REPLACED,
  PROTOCOL_VERSION,
  isValidNickname,
  nicknameKey,
  normalizeNickname,
  type ClientMessage,
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
import type { Clock } from "../infra/clock.ts";
import type { IdGenerator } from "../infra/random.ts";
import { hashToken, newToken } from "../infra/tokens.ts";
import type { Logger } from "../log/logger.ts";
import type { MatchRecord, StoredMatch } from "../match/repository.ts";
import type { EventSink } from "../match/sink.ts";
import type { PuzzleCatalog } from "../puzzles/catalog.ts";
import {
  CLOSE_SERVICE_RESTART,
  GRACE_MS,
  IDEMPOTENCY_ENTRIES,
  PRESENCE_WINDOW_MS,
} from "./limits.ts";
import { Lru } from "./lru.ts";

/** La conexión de un cliente, como la ve una sala (la implementa `RoomServer`). */
export interface Session {
  readonly id: number;
  readonly playerId: string | null;
  send(envelope: ServerEnvelope, options?: { readonly droppable?: boolean }): void;
  close(code: number, reason: string): void;
  /** La conexión queda asociada a un jugador de la sala. */
  bind(room: Room, playerId: string): void;
  /** La conexión deja la sala (salida o reemplazo). */
  unbind(): void;
}

export interface RoomDeps {
  readonly clock: Clock;
  readonly random: Rng;
  readonly ids: IdGenerator;
  readonly catalog: PuzzleCatalog;
  readonly sink: EventSink;
  readonly logger: Logger;
  readonly mode: GameMode;
  /** La sala se borró (R-14): sale del `RoomStore`. */
  readonly onDeleted: (room: Room) => void;
  /** Se perdieron eventos sin confirmar (E-16): la sala se cerró y hay que reconstruirla. */
  readonly onLost: (room: Room) => void;
}

interface Member {
  readonly id: string;
  readonly nickname: string;
  readonly nicknameKey: string;
  seat: number | null;
  /** El último asiento, para intentar devolverlo al volver con ficha (SPEC §3.2). */
  lastSeat: number | null;
  readonly joinedAt: number;
  readonly tokenHash: string;
  connection: Connection;
  settings: Settings;
  /** La conexión asociada; `ready` cuando ya recibió su bienvenida. */
  session: Session | null;
  ready: boolean;
  cancelGrace: (() => void) | null;
  /** Respuestas al autor por `clientMsgId` (§4.6, E-07). */
  readonly replies: Lru<string, readonly ServerEnvelope[]>;
  readonly presence: { cell: number | null; sent: number | null; open: boolean };
}

interface LiveMatch {
  state: MatchState;
  readonly puzzle: PublicPuzzle;
  readonly solution: readonly number[];
}

interface Author {
  readonly playerId: string;
  readonly clientMsgId: string;
}
type Body = Pick<ServerEnvelope, "type" | "payload">;

type MemberCommand = Exclude<ClientMessage, { type: "room.create" | "room.join" | "sys.ping" }>;

const GAME_COMMANDS = new Set<string>([
  "cell.place",
  "hint.use",
  "note.add",
  "note.remove",
  "note.undo",
]);

export class Room {
  readonly code: string;
  state: RoomState = "waiting";
  starterId: string | null = null;
  difficulty: Difficulty = "easy";
  readonly members = new Map<string, Member>();
  match: LiveMatch | null = null;
  readonly playedPuzzleIds: string[] = [];
  emptySince: number | null = null;
  deleted = false;

  private readonly deps: RoomDeps;
  private queue: Promise<void> = Promise.resolve();
  private outbox: Promise<void> = Promise.resolve();
  private cancelDeletion: (() => void) | null = null;

  constructor(code: string, deps: RoomDeps) {
    this.code = code;
    this.deps = deps;
  }

  // --- Cola y bandeja de salida ---

  /** Agrega una tarea a la cola de la sala: se procesan de a una, en orden de llegada (§4.6). */
  enqueue(task: () => void | Promise<void>, onError?: (errorId: string) => void): void {
    this.queue = this.queue.then(async () => {
      if (this.deleted) return;
      try {
        await task();
      } catch (error) {
        const errorId = this.deps.ids();
        this.deps.logger.error("room task failed", { errorId, room: this.code, error });
        onError?.(errorId);
      }
    });
  }

  /**
   * Se resuelve cuando la cola y la bandeja de salida quedan vacías, o cuando la base de datos deja
   * de confirmar y la bandeja queda esperando (para las pruebas).
   */
  async idle(): Promise<void> {
    for (;;) {
      const queue = this.queue;
      const outbox = this.outbox;
      await queue;
      await Promise.race([outbox, this.deps.sink.stalled()]);
      if (this.deps.sink.unavailable) return;
      if (queue === this.queue && outbox === this.outbox) return;
    }
  }

  /** Entrega `deliver` después de lo anterior y de `after` (la confirmación de los eventos). */
  private release(after: Promise<void> | null, deliver: () => void): void {
    this.outbox = this.outbox.then(async () => {
      try {
        if (after) await after;
      } catch {
        // Un evento sin confirmar no se difunde (T-32.3): la sala se reconstruye (E-16).
        this.lost();
        return;
      }
      if (!this.deleted) deliver();
    });
  }

  /**
   * E-16: se perdieron eventos que no se confirmaron. La sala se cierra (las conexiones con 1012, y
   * el cliente se reconecta) y el servidor la reconstruye desde el registro confirmado.
   */
  private lost(): void {
    if (this.deleted) return;
    this.deleted = true;
    this.cancelDeletion?.();
    this.cancelDeletion = null;
    for (const member of this.members.values()) {
      member.cancelGrace?.();
      member.cancelGrace = null;
      const session = member.session;
      member.session = null;
      session?.unbind();
      session?.close(CLOSE_SERVICE_RESTART, "service restart");
    }
    this.deps.logger.warn("room closed to rebuild from the log", { room: this.code });
    this.deps.onLost(this);
  }

  /** La respuesta sale en el acto: no depende de ningún evento pendiente. */
  private unavailable(session: Session, replyTo: string): void {
    session.send({ v: 1, type: "error", payload: { code: "server.unavailable" }, replyTo });
  }

  /**
   * Apagado del servidor: la sala deja de procesar y cancela sus plazos. Lo que ya decidió se
   * termina de escribir; quienes estaban conectados quedan `disconnected` al reconstruirla.
   */
  shutdown(): void {
    this.deleted = true;
    this.cancelDeletion?.();
    this.cancelDeletion = null;
    for (const member of this.members.values()) {
      member.cancelGrace?.();
      member.cancelGrace = null;
    }
  }

  /** Mientras la base de datos no confirma, se rechaza lo que agregaría eventos (E-16). */
  private writesBlocked(): boolean {
    return this.deps.sink.unavailable;
  }

  private recipients(): string[] {
    return [...this.members.values()].flatMap((m) => (m.session && m.ready ? [m.id] : []));
  }

  /**
   * Difunde `outgoing` después de `after`. La copia del autor lleva `replyTo` y queda guardada para
   * la idempotencia, aunque el autor esté desconectado.
   */
  private emit(
    outgoing: readonly Outgoing[],
    author: Author | null,
    after: Promise<void> | null = null,
  ): void {
    if (author) {
      const member = this.members.get(author.playerId);
      const copies = fanOut(outgoing, [author.playerId], author).map((d) => d.envelope);
      member?.replies.set(author.clientMsgId, copies);
    }
    this.release(after, () => {
      for (const { to, envelope } of fanOut(outgoing, this.recipients(), author ?? undefined)) {
        this.members.get(to)?.session?.send(envelope);
      }
    });
  }

  private reply(author: Author, body: Body): void {
    this.emit(
      [{ audience: { kind: "only", playerId: author.playerId }, ...body } as Outgoing],
      author,
    );
  }

  private fail(author: Author, code: ErrorCode, reason?: string): void {
    this.reply(author, {
      type: "error",
      payload: reason === undefined ? { code } : { code, reason },
    });
  }

  /** Respuesta a una conexión que todavía no es (o ya no es) miembro. */
  private answer(session: Session, replyTo: string, body: Body): void {
    this.release(null, () => {
      session.send({ v: 1, ...body, replyTo } as ServerEnvelope);
    });
  }

  private broadcast(type: Outgoing["type"], payload: Outgoing["payload"], except?: string): void {
    const audience =
      except === undefined
        ? { kind: "all" as const }
        : { kind: "except" as const, playerId: except };
    this.emit([{ audience, type, payload } as Outgoing], null);
  }

  // --- Partida ---

  private get context() {
    if (!this.match) throw new Error("No match");
    return { mode: this.deps.mode, puzzle: this.match.puzzle };
  }

  /** Aplica los eventos, los entrega al destino y difunde sus mensajes cuando se confirman. */
  private commit(events: readonly MatchEvent[], author: Author | null, record?: MatchRecord): void {
    const match = this.match;
    if (!match || events.length === 0) return;
    const outgoing: Outgoing[] = [];
    let ended = false;
    for (const event of events) {
      const { state, effects } = applyWithEffects(match.state, event, this.context);
      match.state = state;
      outgoing.push(...messagesOf(event, state, effects, this.deps.mode));
      if (event.type === "match.ended") ended = true;
    }
    const written = this.deps.sink.write({
      ...(record ? { match: record } : {}),
      matchId: match.state.id,
      events,
    });
    this.emit(outgoing, author, written);
    if (ended) this.finish();
  }

  private decided(decision: Decision, author: Author | null): void {
    if (!decision.ok) {
      if (author) this.reply(author, decision.reply);
      return;
    }
    this.commit(decision.events, author);
  }

  private inMatch(member: Member): boolean {
    return this.state === "running" && this.match?.state.players.has(member.id) === true;
  }

  /** La partida terminó: la sala pasa a `finished` y se purgan los que salieron o expiraron (§3.1). */
  private finish(): void {
    this.state = "finished";
    this.broadcast("room.state_changed", { state: "finished" });
    for (const member of [...this.members.values()]) {
      if (member.connection === "left" || member.connection === "expired") this.purge(member);
    }
  }

  // --- Vista ---

  private publicPlayersNow(): PublicPlayer[] {
    const match = this.match;
    if (this.state === "running" && match) return publicPlayers(match.state);
    return [...this.members.values()].map((member) => {
      const inMatch = this.state === "finished" ? match?.state.players.get(member.id) : undefined;
      return inMatch
        ? { ...publicPlayer(inMatch), seat: member.seat, connection: member.connection }
        : lobbyPlayer(member);
    });
  }

  private view(): RoomView {
    return {
      code: this.code,
      state: this.state,
      starterId: this.starterId,
      difficulty: this.difficulty,
      players: this.publicPlayersNow(),
    };
  }

  /** Snapshot del estado al decidir (§4.5): se entrega después de todo lo anterior. */
  private snapshot(member: Member): Snapshot {
    const now = this.deps.clock.now();
    const match = this.match;
    if (match && this.state !== "waiting") {
      return snapshotFor(match.state, this.view(), member.id, now, this.deps.mode);
    }
    return lobbySnapshot(this.view(), member, now);
  }

  private welcome(session: Session, member: Member, replyTo: string, token?: string): void {
    const envelope = {
      v: 1,
      type: "room.welcome",
      replyTo,
      payload: {
        playerId: member.id,
        ...(token === undefined ? {} : { token }),
        snapshot: this.snapshot(member),
      },
    } as ServerEnvelope;
    this.release(null, () => {
      if (member.session !== session) return;
      session.send(envelope);
      member.ready = true;
    });
  }

  // --- Entrada y salida ---

  /** `room.create` y `room.join` (§4.2). La forma del apodo ya la comprobó quien llama. */
  join(session: Session, message: ClientMessage<"room.create" | "room.join">): void {
    if (this.writesBlocked() && this.state === "running") {
      this.unavailable(session, message.id);
      return;
    }
    const token = message.type === "room.join" ? message.payload.token : undefined;
    if (token !== undefined) {
      const tokenHash = hashToken(token);
      const member = [...this.members.values()].find((m) => m.tokenHash === tokenHash);
      if (member) {
        this.resume(session, member, message.id);
        return;
      }
      // Una ficha que no vale es una entrada nueva con el apodo del mensaje (T-13.3).
    }
    const nickname = normalizeNickname(message.payload.nickname);
    if (!isValidNickname(nickname)) {
      this.answer(session, message.id, { type: "error", payload: { code: "nickname.invalid" } });
      return;
    }
    const seat = freeSeat(this.members.values(), this.deps.mode.rules.maxSeats);
    if (seat === null) {
      this.answer(session, message.id, { type: "error", payload: { code: "room.full" } });
      return;
    }
    const key = nicknameKey(nickname);
    if ([...this.members.values()].some((m) => m.nicknameKey === key)) {
      this.answer(session, message.id, { type: "error", payload: { code: "nickname.taken" } });
      return;
    }
    const fresh = newToken();
    const member: Member = {
      id: this.deps.ids(),
      nickname,
      nicknameKey: key,
      seat,
      lastSeat: seat,
      joinedAt: this.deps.clock.now(),
      tokenHash: hashToken(fresh),
      connection: "connected",
      settings: { autoCleanPersonalNotes: true },
      session,
      ready: false,
      cancelGrace: null,
      replies: new Lru(IDEMPOTENCY_ENTRIES),
      presence: { cell: null, sent: null, open: false },
    };
    this.members.set(member.id, member);
    session.bind(this, member.id);
    if (this.state === "running" && this.match) {
      this.decided(
        decideJoin(this.match.state, this.entryOf(member), this.deps.mode, member.joinedAt),
        null,
      );
    } else {
      this.broadcast("room.player_joined", { player: lobbyPlayer(member) }, member.id);
    }
    if (this.starterId === null) this.setStarter(member.id);
    this.welcome(session, member, message.id, fresh);
    this.checkEmpty();
  }

  /** Vuelta con ficha (D3, D3', E-08). */
  private resume(session: Session, member: Member, replyTo: string): void {
    switch (member.connection) {
      case "connected": {
        // E-08: la conexión nueva reemplaza a la anterior.
        const previous = member.session;
        member.session = null;
        member.ready = false;
        if (previous) {
          previous.unbind();
          previous.close(CLOSE_REPLACED, "replaced");
        }
        break;
      }
      case "disconnected":
        member.cancelGrace?.();
        member.cancelGrace = null;
        this.setConnection(member, "connected", member.seat);
        break;
      case "left":
      case "expired": {
        const seat = seatFor(this.members.values(), this.deps.mode.rules.maxSeats, member.lastSeat);
        if (seat === null) {
          // T-26.4: sin cupo, sus datos siguen guardados.
          this.answer(session, replyTo, { type: "error", payload: { code: "room.full" } });
          return;
        }
        this.setConnection(member, "connected", seat);
        break;
      }
    }
    member.session = session;
    member.ready = false;
    session.bind(this, member.id);
    this.welcome(session, member, replyTo);
    this.checkEmpty();
  }

  /** La conexión del jugador se cerró sin `room.leave`. */
  disconnect(session: Session): void {
    const member = session.playerId === null ? undefined : this.members.get(session.playerId);
    if (member?.session !== session) return;
    member.session = null;
    member.ready = false;
    this.setConnection(member, "disconnected", member.seat);
    this.startGrace(member);
    this.checkEmpty();
  }

  /** El plazo de gracia de 120 s (R-13): si no vuelve, expira. */
  private startGrace(member: Member): void {
    member.cancelGrace?.();
    member.cancelGrace = this.deps.clock.setTimeout(() => {
      this.enqueue(() => {
        this.expire(member);
      });
    }, GRACE_MS);
  }

  private expire(member: Member): void {
    member.cancelGrace = null;
    if (member.connection !== "disconnected" || this.members.get(member.id) !== member) return;
    this.setConnection(member, "expired", null);
    this.checkEmpty();
  }

  private leave(session: Session, member: Member, replyTo: string): void {
    // El autor recibe el `ack` aunque deja de ser miembro al instante.
    this.answer(session, replyTo, { type: "ack", payload: { applied: true } });
    member.session = null;
    member.ready = false;
    member.cancelGrace?.();
    member.cancelGrace = null;
    session.unbind();
    this.setConnection(member, "left", null);
    this.checkEmpty();
  }

  /**
   * Cambio de conexión (§3.2). En partida es un evento del registro; fuera de partida, quien sale o
   * expira se purga. Después, si hace falta, pasa el derecho de iniciar (R-11).
   */
  private setConnection(member: Member, connection: Connection, seat: number | null): void {
    if (seat !== null) member.lastSeat = seat;
    member.connection = connection;
    member.seat = seat;
    const gone = connection === "left" || connection === "expired";
    if (this.inMatch(member) && this.match) {
      const change = { playerId: member.id, connection, seat };
      this.decided(
        decideConnection(this.match.state, change, this.deps.mode, this.deps.clock.now()),
        null,
      );
    } else if (gone) {
      this.purge(member);
    } else {
      this.broadcast("room.player_connection", { playerId: member.id, connection, seat });
    }
    if (gone) this.passStarter();
  }

  /** El jugador sale de la sala: su apodo queda libre y su ficha deja de valer. */
  private purge(member: Member): void {
    member.cancelGrace?.();
    member.cancelGrace = null;
    if (!this.members.delete(member.id)) return;
    this.broadcast("room.player_removed", { playerId: member.id });
  }

  private passStarter(): void {
    const current = this.starterId === null ? undefined : this.members.get(this.starterId);
    if (current && holdsSeat(current)) return;
    this.setStarter(nextStarter(this.members.values()));
  }

  private setStarter(playerId: string | null): void {
    if (playerId === this.starterId) return;
    this.starterId = playerId;
    if (this.state === "running" && this.match) {
      this.decided(decideStarter(this.match.state, playerId, this.deps.clock.now()), null);
    } else {
      this.broadcast("room.starter_changed", { playerId });
    }
  }

  // --- Borrado (R-14) ---

  private checkEmpty(): void {
    const anyone = [...this.members.values()].some((m) => m.connection === "connected");
    if (anyone) {
      this.cancelDeletion?.();
      this.cancelDeletion = null;
      this.emptySince = null;
      return;
    }
    if (this.emptySince !== null) return;
    this.emptySince = this.deps.clock.now();
    this.cancelDeletion = this.deps.clock.setTimeout(() => {
      this.enqueue(() => this.expireRoom());
    }, GRACE_MS);
  }

  /** 120 s sin nadie conectado: expiran todos (con la derrota si había partida) y se borra. */
  private async expireRoom(): Promise<void> {
    this.cancelDeletion = null;
    if ([...this.members.values()].some((m) => m.connection === "connected")) return;
    for (const member of [...this.members.values()]) {
      if (member.connection === "disconnected") this.expire(member);
    }
    await this.outbox;
    this.deleted = true;
    for (const member of this.members.values()) member.cancelGrace?.();
    this.deps.logger.info("room deleted", { room: this.code });
    this.deps.onDeleted(this);
  }

  // --- Reconstrucción (ADR 0003, E-15 y E-16) ---

  /**
   * Una sala en curso reconstruida desde su registro confirmado. Quienes figuraban conectados pasan
   * a `disconnected` (con su evento, así el registro sigue reproduciendo el estado), y todos los que
   * tienen asiento reciben un plazo nuevo de 120 s para volver con su ficha (T-32.2). La caché de
   * idempotencia se repuebla con los `clientMsgId` de los eventos (§4.6).
   */
  static restore(
    deps: RoomDeps,
    stored: StoredMatch,
    puzzle: { readonly puzzle: PublicPuzzle; readonly solution: readonly number[] },
  ): Room {
    const [first, ...rest] = stored.events;
    if (first?.type !== "match.started") throw new Error(`Match ${stored.match.id} has no start`);
    const context = { mode: deps.mode, puzzle: puzzle.puzzle };
    let state = initialState(first, context);
    const replies = new Map<string, Map<string, readonly ServerEnvelope[]>>();
    for (const event of rest) {
      const applied = applyWithEffects(state, event, context);
      state = applied.state;
      const author = authorOf(event);
      if (!author) continue;
      const outgoing = messagesOf(event, state, applied.effects, deps.mode);
      const copies = fanOut(outgoing, [author.playerId], author).map((d) => d.envelope);
      const own = replies.get(author.playerId) ?? new Map<string, readonly ServerEnvelope[]>();
      own.set(author.clientMsgId, copies);
      replies.set(author.playerId, own);
    }
    if (state.endedAt !== null) throw new Error(`Match ${stored.match.id} already ended`);

    const room = new Room(stored.match.roomCode, deps);
    room.state = "running";
    room.difficulty = stored.match.difficulty;
    room.starterId = state.starterId;
    room.playedPuzzleIds.push(puzzle.puzzle.id);
    room.match = { state, puzzle: puzzle.puzzle, solution: puzzle.solution };
    for (const player of state.players.values()) {
      const cache = new Lru<string, readonly ServerEnvelope[]>(IDEMPOTENCY_ENTRIES);
      for (const [id, copies] of replies.get(player.id) ?? []) cache.set(id, copies);
      room.members.set(player.id, {
        id: player.id,
        nickname: player.nickname,
        nicknameKey: nicknameKey(player.nickname),
        seat: player.seat,
        lastSeat: player.seat,
        joinedAt: player.joinedAt,
        tokenHash: player.tokenHash,
        connection: player.connection,
        settings: player.settings,
        session: null,
        ready: false,
        cancelGrace: null,
        replies: cache,
        presence: { cell: null, sent: null, open: false },
      });
    }
    for (const member of room.members.values()) {
      if (member.connection === "connected")
        room.setConnection(member, "disconnected", member.seat);
      if (member.connection === "disconnected") room.startGrace(member);
    }
    room.checkEmpty();
    return room;
  }

  // --- Comandos de miembros ---

  /** Un comando de quien ya es miembro (§4.2). */
  async command(session: Session, message: MemberCommand): Promise<void> {
    const member = session.playerId === null ? undefined : this.members.get(session.playerId);
    if (member?.session !== session) {
      this.answer(session, message.id, { type: "error", payload: { code: "room.not_found" } });
      return;
    }
    if (message.type === "presence.select") {
      this.select(member, message.payload.cell);
      return;
    }
    // Idempotencia (§4.6, E-07): un duplicado recibe lo mismo y no se vuelve a aplicar.
    const cached = member.replies.get(message.id);
    if (cached) {
      this.release(null, () => {
        for (const envelope of cached) member.session?.send(envelope);
      });
      return;
    }
    if (this.writesBlocked() && (this.state === "running" || message.type === "match.start")) {
      this.unavailable(session, message.id);
      return;
    }
    const author: Author = { playerId: member.id, clientMsgId: message.id };
    const isStarter = this.starterId === member.id;
    switch (message.type) {
      case "room.leave":
        this.leave(session, member, message.id);
        return;
      case "room.set_difficulty":
        if (!isStarter) {
          this.fail(author, "forbidden");
          return;
        }
        if (this.state !== "waiting") {
          this.fail(author, "room.wrong_state");
          return;
        }
        this.difficulty = message.payload.difficulty;
        this.emit(
          [
            {
              audience: { kind: "all" },
              type: "room.difficulty_set",
              payload: { difficulty: this.difficulty },
            },
          ],
          author,
        );
        return;
      case "room.reset":
        if (!isStarter) {
          this.fail(author, "forbidden");
          return;
        }
        if (this.state !== "finished") {
          this.fail(author, "room.wrong_state");
          return;
        }
        this.state = "waiting";
        this.match = null;
        this.emit(
          [
            {
              audience: { kind: "all" },
              type: "room.state_changed",
              payload: { state: "waiting" },
            },
          ],
          author,
        );
        return;
      case "match.start":
        if (!isStarter) {
          this.fail(author, "forbidden");
          return;
        }
        if (this.state !== "waiting") {
          this.fail(author, "room.wrong_state");
          return;
        }
        await this.start(author);
        return;
      case "settings.update":
        member.settings = { autoCleanPersonalNotes: message.payload.autoCleanPersonalNotes };
        if (this.inMatch(member)) break;
        this.reply(author, { type: "ack", payload: { applied: true } });
        return;
      default:
        if (!GAME_COMMANDS.has(message.type)) {
          this.fail(author, "bad_request");
          return;
        }
    }
    const match = this.match;
    if (this.state !== "running" || !match) {
      this.fail(author, "match.not_running");
      return;
    }
    const decision = decide(match.state, member.id, message, {
      mode: this.deps.mode,
      solution: match.solution,
      at: this.deps.clock.now(),
    });
    this.decided(decision, author);
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

  /** `match.start` (§3.1): elige el puzzle (D9) y registra `match.started`. */
  private async start(author: Author): Promise<void> {
    const { puzzle, solution } = await this.deps.catalog.pick(
      this.difficulty,
      this.playedPuzzleIds,
      this.deps.random,
    );
    const at = this.deps.clock.now();
    const mode = this.deps.mode;
    const started = startMatch({
      matchId: this.deps.ids(),
      puzzle,
      difficulty: this.difficulty,
      starterId: this.starterId,
      players: [...this.members.values()].filter(holdsSeat).map((m) => this.entryOf(m)),
      mode,
      at,
    });
    const state = initialState(started, { mode, puzzle });
    this.match = { state, puzzle, solution };
    this.state = "running";
    this.playedPuzzleIds.push(puzzle.id);
    const record: MatchRecord = {
      id: state.id,
      roomCode: this.code,
      puzzleId: puzzle.id,
      difficulty: this.difficulty,
      modeId: mode.id,
      scoringParamsVersion: mode.scoringParamsVersion,
      protocolVersion: PROTOCOL_VERSION,
      startedAt: at,
    };
    const written = this.deps.sink.write({ match: record, matchId: state.id, events: [started] });
    this.deps.logger.info("match started", {
      room: this.code,
      matchId: state.id,
      puzzleId: puzzle.id,
    });
    this.emit(
      [
        { audience: { kind: "all" }, type: "room.state_changed", payload: { state: "running" } },
        {
          audience: { kind: "all" },
          type: "match.started",
          payload: {
            matchId: state.id,
            puzzle,
            startedAt: state.startedAt,
            hintsLeft: state.hintsLeft,
            players: publicPlayers(state),
          },
          seq: started.seq,
        },
      ],
      author,
      written,
    );
  }

  // --- Presencia (R-24) ---

  /** Como máximo una difusión cada 100 ms por jugador, con la última selección (§4.8). */
  private select(member: Member, cell: number | null): void {
    if (!this.inMatch(member)) return;
    const presence = member.presence;
    presence.cell = cell;
    if (presence.open) return;
    const flush = () => {
      if (presence.sent === presence.cell || this.members.get(member.id) !== member) return;
      presence.sent = presence.cell;
      const envelope = {
        v: 1,
        type: "presence.updated",
        payload: { playerId: member.id, cell: presence.cell },
      } as ServerEnvelope;
      for (const other of this.members.values()) {
        if (other !== member && other.ready) other.session?.send(envelope, { droppable: true });
      }
      presence.open = true;
      this.deps.clock.setTimeout(() => {
        presence.open = false;
        flush();
      }, PRESENCE_WINDOW_MS);
    };
    flush();
  }
}

/** Autor y `clientMsgId` de los eventos que salen de un comando (para la idempotencia). */
function authorOf(event: MatchEvent): Author | null {
  switch (event.type) {
    case "cell.solved":
    case "cell.mistake":
    case "hint.used":
    case "note.op":
    case "settings.changed":
      return { playerId: event.payload.playerId, clientMsgId: event.payload.clientMsgId };
    default:
      return null;
  }
}
