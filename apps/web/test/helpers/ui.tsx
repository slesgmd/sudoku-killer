// Ayudas de las pruebas de componentes: un transporte falso (la prueba hace de servidor y emite los
// mensajes que quiere), un puzzle pequeño y la pantalla de partida montada con Testing Library.
import { act, render, screen } from "@testing-library/react";
import type {
  ClientEnvelope,
  PublicPlayer,
  PublicPuzzle,
  ServerEnvelope,
} from "@sudoku-killer/protocol";
import { useSyncExternalStore } from "react";
import { GameClient } from "../../src/game/client.ts";
import { memoryPrefs, type Prefs } from "../../src/game/prefs.ts";
import { GameScreen } from "../../src/screens/GameScreen.tsx";
import { Listeners, type Transport, type TransportStatus } from "../../src/transport/types.ts";

export interface FakeTransport extends Transport {
  readonly sent: ClientEnvelope[];
  /** Entrega un mensaje del servidor al cliente. */
  emit(message: Omit<ServerEnvelope, "v">): void;
  /** El último mensaje enviado de un tipo. */
  last<T extends ClientEnvelope["type"]>(type: T): Extract<ClientEnvelope, { type: T }> | undefined;
}

export function fakeTransport(): FakeTransport {
  const messages = new Listeners<ServerEnvelope>();
  const statuses = new Listeners<TransportStatus>();
  const sent: ClientEnvelope[] = [];
  return {
    sent,
    status: "open",
    send(message) {
      sent.push(message);
    },
    subscribe: (listener) => messages.add(listener),
    onStatus: (listener) => statuses.add(listener),
    close() {
      // Nada que cerrar.
    },
    emit(message) {
      act(() => {
        messages.emit({ v: 1, ...message } as ServerEnvelope);
      });
    },
    last(type) {
      return sent.filter((m) => m.type === type).at(-1) as never;
    },
  };
}

/**
 * Puzzle de prueba de 9 × 9 (las sumas no importan al cliente). Jaulas horizontales de 2, 2, 2 y 3
 * celdas por fila, salvo una en L, [20, 29, 30] (F3 C3, F4 C3 y F4 C4), que sale de la fila, la
 * columna y la caja de la celda 20 (T-33.1). Un número inicial: un 5 en la celda 0.
 */
export function testPuzzle(): PublicPuzzle {
  const lShape = [20, 29, 30];
  const cages: { id: number; cells: number[]; sum: number }[] = [{ id: 0, cells: lShape, sum: 12 }];
  for (let row = 0; row < 9; row++) {
    const free = Array.from({ length: 9 }, (_, col) => row * 9 + col).filter(
      (c) => !lShape.includes(c),
    );
    for (let i = 0; i < free.length;) {
      const take = free.length - i === 3 ? 3 : 2;
      cages.push({ id: cages.length, cells: free.slice(i, i + take), sum: 10 });
      i += take;
    }
  }
  return {
    id: "puzzle-test",
    size: 9,
    boxRows: 3,
    boxCols: 3,
    difficulty: "easy",
    cages,
    givens: [{ cell: 0, value: 5 }],
  };
}

export function player(id: string, nickname: string, seat: number): PublicPlayer {
  return {
    id,
    nickname,
    seat,
    joinedAt: seat,
    connection: "connected",
    role: "active",
    lives: 3,
    score: 0,
    mistakes: 0,
  };
}

export const ME = player("p-ines", "Inés", 0);
export const TOMAS = player("p-tomas", "Tomás", 1);

export function Screen({ client }: { readonly client: GameClient }) {
  const state = useSyncExternalStore(client.subscribe, client.getState);
  return <GameScreen client={client} state={state} />;
}

export interface Mounted {
  readonly client: GameClient;
  readonly transport: FakeTransport;
}

/**
 * Monta la partida: entra con `room.welcome` y recibe `match.started` con dos jugadores (tú e
 * Tomás). `now` es el reloj del cliente.
 */
export function mountGame({
  now,
  startedAt = 1_000_000,
  serverNow = startedAt,
  prefs = memoryPrefs(),
}: { now?: () => number; startedAt?: number; serverNow?: number; prefs?: Prefs } = {}): Mounted {
  const transport = fakeTransport();
  const client = new GameClient({ transport, prefs, ...(now ? { now } : {}) });
  client.start("Inés", "easy");
  const create = transport.last("room.create");
  render(<Screen client={client} />);
  transport.emit({
    type: "room.welcome",
    ...(create ? { replyTo: create.id } : {}),
    payload: {
      playerId: ME.id,
      snapshot: {
        serverNow,
        atSeq: null,
        room: {
          code: "HPQ6NZ",
          state: "waiting",
          starterId: ME.id,
          difficulty: "easy",
          players: [ME],
        },
        match: null,
        you: { playerId: ME.id, settings: { autoCleanPersonalNotes: true }, personalNotes: [] },
      },
    },
  });
  transport.emit({
    type: "match.started",
    payload: { matchId: "m1", puzzle: testPuzzle(), startedAt, hintsLeft: 3, players: [ME, TOMAS] },
  });
  return { client, transport };
}

/** El botón de una celda (fila y columna desde 1). */
export function cellButton(row: number, col: number): HTMLElement {
  return screen.getByRole("button", {
    name: new RegExp(`^Fila ${String(row)}, columna ${String(col)},`),
  });
}

/** La celda (`gridcell`) que contiene el botón. */
export function gridCell(row: number, col: number): HTMLElement {
  const cell = cellButton(row, col).closest<HTMLElement>("[role=gridcell]");
  if (!cell) throw new Error("No gridcell");
  return cell;
}
