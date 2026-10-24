// Ayudas de las pruebas del reductor: partidas sobre puzzles regenerados del banco y un "servidor en
// vivo" mínimo que decide, aplica y proyecta como lo harán el simulador y F9.
import { regenerateSeed } from "@sudoku-killer/bank";
import { PARAMS_V1 } from "@sudoku-killer/scoring";
import type { ClientMessage, PublicPuzzle, ServerEnvelope } from "@sudoku-killer/protocol";
import {
  applyWithEffects,
  createNormalMode,
  decide,
  fanOut,
  initialState,
  messagesOf,
  startMatch,
  type Decision,
  type GameCommand,
  type MatchEvent,
  type MatchState,
  type PlayerEntry,
} from "../../src/index.ts";

export const mode = createNormalMode(PARAMS_V1);

export interface Fixture {
  readonly puzzle: PublicPuzzle;
  readonly solution: readonly number[];
}

const fixtures = new Map<number, Fixture>();

/** Puzzle del banco regenerado desde su semilla (4: fácil, 1: media), memoizado. */
export function fixture(seed: number): Fixture {
  const cached = fixtures.get(seed);
  if (cached) return cached;
  const { difficulty, generated } = regenerateSeed(seed);
  const { puzzle, solution } = generated;
  const made: Fixture = {
    puzzle: {
      id: `puzzle-${String(seed)}`,
      size: puzzle.size,
      boxRows: puzzle.boxRows,
      boxCols: puzzle.boxCols,
      difficulty,
      cages: puzzle.cages.map(({ id, cells, sum }) => ({ id, cells: [...cells], sum })),
      givens: puzzle.givens.map(({ cell, value }) => ({ cell, value })),
    },
    solution,
  };
  fixtures.set(seed, made);
  return made;
}

export function entry(index: number, at = 0): PlayerEntry {
  return {
    playerId: `p${String(index)}`,
    nickname: `Jugador ${String(index)}`,
    seat: index,
    joinedAt: at,
    tokenHash: `hash-${String(index)}`,
    connection: "connected",
    autoCleanPersonalNotes: true,
  };
}

/** Partida en vivo: aplica cada decisión y guarda el registro y los mensajes enviados. */
export class LiveMatch {
  state: MatchState;
  readonly log: MatchEvent[];
  readonly sent: { to: string; envelope: ServerEnvelope }[] = [];
  now = 1000;
  readonly fixture: Fixture;
  private nextId = 1;

  constructor(fixture: Fixture, players: number) {
    this.fixture = fixture;
    const started = startMatch({
      matchId: "m1",
      puzzle: fixture.puzzle,
      difficulty: fixture.puzzle.difficulty,
      starterId: "p0",
      players: Array.from({ length: players }, (_, i) => entry(i)),
      mode,
      at: this.now,
    });
    this.log = [started];
    this.state = initialState(started, { mode, puzzle: fixture.puzzle });
  }

  /** Aplica los eventos de una decisión y devuelve la decisión. */
  commit(decision: Decision, author?: { playerId: string; clientMsgId: string }): Decision {
    if (!decision.ok) {
      if (author) {
        this.sent.push({
          to: author.playerId,
          envelope: { v: 1, ...decision.reply, replyTo: author.clientMsgId },
        });
      }
      return decision;
    }
    const recipients = [...this.state.players.keys()];
    for (const event of decision.events) {
      const { state, effects } = applyWithEffects(this.state, event, {
        mode,
        puzzle: this.fixture.puzzle,
      });
      this.state = state;
      this.log.push(event);
      this.sent.push(...fanOut(messagesOf(event, state, effects, mode), recipients, author));
    }
    return decision;
  }

  /** Envía un comando de juego del jugador. */
  send<T extends GameCommand["type"]>(
    playerId: string,
    type: T,
    payload: ClientMessage<T>["payload"],
  ): Decision {
    this.now += 10;
    const id = `c${String(this.nextId++)}`;
    const command = { v: 1, id, type, payload } as GameCommand;
    const decision = decide(this.state, playerId, command, {
      mode,
      solution: this.fixture.solution,
      at: this.now,
    });
    return this.commit(decision, { playerId, clientMsgId: id });
  }

  /** Dígito de la solución en `cell`. */
  answer(cell: number): number {
    const digit = this.fixture.solution[cell];
    if (digit === undefined) throw new RangeError(String(cell));
    return digit;
  }

  /** Un dígito incorrecto para `cell`. */
  wrong(cell: number, offset = 0): number {
    const size = this.fixture.puzzle.size;
    return ((this.answer(cell) + offset) % size) + 1;
  }

  /** Celdas vacías, en orden. */
  emptyCells(): number[] {
    return this.state.cells.flatMap((cell, i) => (cell.status === "empty" ? [i] : []));
  }

  /** Mensajes que recibió `playerId` desde el índice `from` de `sent`. */
  inbox(playerId: string, from = 0): ServerEnvelope[] {
    return this.sent.slice(from).flatMap(({ to, envelope }) => (to === playerId ? [envelope] : []));
  }
}
