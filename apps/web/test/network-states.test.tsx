// F10f: los estados de red dentro de una sala (docs/diseno.md §9) y las transiciones que el prototipo
// no dibuja (entrega-f8.md §4): reconectando, servidor no disponible, otra pestaña, versión
// incompatible, demasiadas acciones, acción no permitida, no se pudo deshacer, notas recuperadas,
// llegada directa a una partida en curso, vuelta con ficha a una sala llena, regreso al estado
// normal y la decisión 3.
import type { PublicPlayer, Snapshot } from "@sudoku-killer/protocol";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Screens } from "../src/App.tsx";
import { GameClient } from "../src/game/client.ts";
import { memoryPrefs } from "../src/game/prefs.ts";
import { memorySession, type SessionStore } from "../src/game/session.ts";
import { navigate } from "../src/routes.ts";
import {
  ME,
  TOMAS,
  cellButton,
  fakeTransport,
  testPuzzle,
  type FakeTransport,
} from "./helpers/ui.tsx";

const CODE = "HPQ6NZ";
const TOKEN = "ficha-secreta-de-ines";

beforeEach(() => {
  window.history.replaceState(null, "", "#/");
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "#/");
});

function snapshot({
  state = "running",
  players = [ME, TOMAS],
  ended = false,
}: {
  state?: "waiting" | "running" | "finished";
  players?: PublicPlayer[];
  ended?: boolean;
} = {}): Snapshot {
  return {
    serverNow: 2_000_000,
    atSeq: state === "waiting" ? null : 3,
    room: { code: CODE, state, starterId: ME.id, difficulty: "easy", players },
    match:
      state === "waiting"
        ? null
        : {
            id: "m1",
            puzzle: testPuzzle(),
            startedAt: 1_000_000,
            endedAt: ended ? 1_500_000 : null,
            result: ended ? "defeat" : null,
            hintsLeft: 3,
            locked: [{ cell: 0, value: 5, source: "given", by: null }],
            groupNotes: [],
            ranking: ended
              ? [
                  {
                    playerId: ME.id,
                    nickname: "Inés",
                    score: 0,
                    mistakes: 0,
                    scoreReachedAt: null,
                    position: 1,
                  },
                ]
              : null,
          },
    you: { playerId: ME.id, settings: { autoCleanPersonalNotes: true }, personalNotes: [] },
  };
}

interface Mounted {
  readonly client: GameClient;
  readonly transport: FakeTransport;
  readonly reload: () => void;
}

/** Entra con «Entrar» y recibe la bienvenida con el snapshot que se indica. */
function entered(snap: Snapshot = snapshot(), session: SessionStore = memorySession()): Mounted {
  window.history.replaceState(null, "", "#/entrar");
  const transport = fakeTransport();
  const client = new GameClient({ transport, prefs: memoryPrefs(), session });
  const reload = vi.fn();
  render(<Screens client={client} share={{}} reload={reload} />);
  client.join(CODE, "Inés");
  welcome(transport, snap);
  return { client, transport, reload };
}

function welcome(transport: FakeTransport, snap: Snapshot): void {
  const join = transport.last("room.join");
  transport.emit({
    type: "room.welcome",
    ...(join ? { replyTo: join.id } : {}),
    payload: { playerId: ME.id, token: TOKEN, snapshot: snap },
  });
}

/** Los textos de los avisos breves (también quedan en el registro de actividad). */
const toastTexts = () =>
  [...document.querySelectorAll(".toasts .toast > span")].map((text) => text.textContent);

const key = (name: RegExp) => screen.getByRole("button", { name });

describe("F10f reconnecting (banner + integrated)", () => {
  it("blocks numbers and the hint, queues notes and says how many; back to normal with a notice", () => {
    const { client, transport } = entered();
    act(() => {
      client.select(1);
    });
    transport.setStatus("reconnecting");
    expect(screen.getByText("Reconectando…")).toBeDefined();
    // Los números se bloquean: el teclado escribe notas y la pista queda inactiva.
    expect(key(/^Nota 3, quedan/)).toBeDefined();
    expect(key(/^Pista/).getAttribute("aria-disabled")).toBe("true");
    // Las notas siguen y se encolan.
    fireEvent.keyDown(window, { key: "n" });
    fireEvent.keyDown(window, { key: "3" });
    fireEvent.keyDown(window, { key: "4" });
    expect(
      screen.getByText(/Tus notas se guardan y se enviarán al volver \(2 en cola\)\./),
    ).toBeDefined();
    transport.setStatus("open");
    welcome(transport, snapshot());
    expect(screen.queryByText("Reconectando…")).toBeNull();
    expect(toastTexts()).toContain("Conexión recuperada. Se enviaron 2 notas en cola.");
    expect(cellButton(1, 2).getAttribute("aria-label")).toContain("notas personales");
  });

  it("in the lobby too, with the room text", () => {
    const { transport } = entered(snapshot({ state: "waiting", players: [{ ...ME, role: null }] }));
    expect(screen.getByRole("heading", { name: "Sala de espera" })).toBeDefined();
    transport.setStatus("reconnecting");
    expect(screen.getByText("Lo que pase en la sala se verá al volver.")).toBeDefined();
  });
});

describe("F10f server unavailable (error banner + integrated)", () => {
  it("is announced as an alert and blocks everything that is sent, notes and undo included", () => {
    const { client, transport } = entered();
    act(() => {
      client.select(1);
    });
    transport.setStatus("unavailable");
    expect(screen.getByRole("alert").textContent).toContain(
      "El servidor no responde. Lo que hagas no se registrará hasta que vuelva. Reintentando…",
    );
    const before = transport.sent.length;
    fireEvent.keyDown(window, { key: "n" });
    fireEvent.keyDown(window, { key: "3" });
    act(() => {
      client.input(3);
      client.undo();
    });
    expect(client.getState().pendingNotes).toHaveLength(0);
    expect(transport.sent.slice(before).filter((m) => m.type !== "sys.ping")).toEqual([]);
    expect(key(/^Nota 3/).getAttribute("aria-disabled")).toBe("true");
  });
});

describe("F10f blocking dialogs", () => {
  it("another tab: an alertdialog without a way out but «Jugar en esta pestaña»", () => {
    const { transport } = entered();
    const reconnect = vi.spyOn(transport, "reconnect");
    transport.setStatus("replaced");
    const dialog = screen.getByRole("alertdialog", {
      name: "La sala está abierta en otra pestaña",
    });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeDefined();
    expect(within(dialog).getAllByRole("button")).toHaveLength(1);
    const action = within(dialog).getByRole("button", { name: "Jugar en esta pestaña" });
    expect(document.activeElement).toBe(action);
    fireEvent.click(action);
    expect(reconnect).toHaveBeenCalledTimes(1);
    transport.setStatus("open");
    welcome(transport, snapshot());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("an incompatible version: «Recargar» reloads the page and recalls the 2 minutes", () => {
    const { transport, reload } = entered();
    transport.setStatus("incompatible");
    const dialog = screen.getByRole("alertdialog", { name: "Hay una versión nueva del juego" });
    expect(dialog.textContent).toContain("conservas tu asiento durante 2 minutos");
    fireEvent.click(within(dialog).getByRole("button", { name: "Recargar" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("F10f notices that answer a command", () => {
  it("too many actions and a forbidden action", () => {
    const { client, transport } = entered();
    act(() => {
      client.select(1);
    });
    fireEvent.keyDown(window, { key: "3" });
    const place = transport.last("cell.place");
    transport.emit({
      type: "error",
      ...(place ? { replyTo: place.id } : {}),
      payload: { code: "rate_limited" },
    });
    expect(toastTexts()).toContain(
      "Vas muy rápido: la última acción no se envió. Espera un momento y repítela.",
    );
    act(() => {
      client.useHint();
    });
    const hint = transport.last("hint.use");
    transport.emit({
      type: "error",
      ...(hint ? { replyTo: hint.id } : {}),
      payload: { code: "forbidden" },
    });
    expect(toastTexts()).toContain(
      "No se usó la pista: ya eres espectador y solo puedes escribir notas.",
    );
  });

  it("undoing «Borrar notas» says how many notes came back", () => {
    const { client, transport } = entered();
    act(() => {
      client.select(1);
      client.setMode("notes");
    });
    let opSeq = 10;
    const confirmed = new Set<string>();
    /** El servidor confirma las notas enviadas que todavía no confirmó. */
    const confirm = () => {
      for (const message of transport.sent) {
        if (message.type !== "note.add" && message.type !== "note.remove") continue;
        if (confirmed.has(message.id)) continue;
        confirmed.add(message.id);
        transport.emit({
          type: "note.applied",
          seq: opSeq,
          replyTo: message.id,
          payload: {
            ...message.payload,
            op: message.type === "note.add" ? "add" : "remove",
            opSeq: opSeq++,
            by: ME.id,
          },
        });
      }
    };
    act(() => {
      client.input(2);
      client.input(5);
      client.input(7);
    });
    confirm();
    act(() => {
      client.clearNotes();
    });
    confirm();
    act(() => {
      client.undo();
    });
    const undos = transport.sent.filter((m) => m.type === "note.undo");
    expect(undos).toHaveLength(3);
    undos.forEach((undo, i) => {
      if (i === 0) {
        transport.emit({
          type: "error",
          replyTo: undo.id,
          payload: { code: "undo.not_applicable" },
        } as never);
        return;
      }
      transport.emit({
        type: "note.applied",
        seq: opSeq,
        replyTo: undo.id,
        payload: {
          layer: "personal",
          op: "add",
          cell: 1,
          digit: i === 1 ? 5 : 7,
          opSeq: opSeq++,
          undoOf: 1,
          by: ME.id,
        },
      } as never);
    });
    expect(toastTexts()).toContain(
      "Se recuperaron 2 de 3 notas. La otra cambió después de que la borraras.",
    );
  });
});

describe("F10f transitions that were not drawn", () => {
  it("arriving straight into a running match: the board and a notice", () => {
    entered(snapshot({ players: [ME, TOMAS] }));
    expect(screen.getByRole("grid", { name: "Tablero" })).toBeDefined();
    expect(toastTexts().join(" ")).toContain("Entraste en una partida en curso");
  });

  it("coming back with a token to a full room: Inicio says so and keeps the token", () => {
    const session = memorySession();
    session.saveToken(CODE, TOKEN);
    session.saveNickname("Inés");
    session.saveLastRoom(CODE);
    window.history.replaceState(null, "", `#/sala/${CODE}`);
    const transport = fakeTransport();
    const client = new GameClient({ transport, prefs: memoryPrefs(), session });
    render(<Screens client={client} share={{}} />);
    const join = transport.last("room.join");
    transport.emit({
      type: "error",
      ...(join ? { replyTo: join.id } : {}),
      payload: { code: "room.full" },
    });
    expect(window.location.hash).toBe("#/");
    expect(screen.getByRole("status").textContent).toContain(
      `La sala ${CODE} no tiene asientos libres.`,
    );
    expect(session.token(CODE)).toBe(TOKEN);
    expect(transport.sent.filter((m) => m.type === "room.join")).toHaveLength(1);
  });

  it("a room that filled up during a reconnection sends the player to Inicio with the notice", () => {
    const { transport } = entered();
    transport.setStatus("reconnecting");
    transport.setStatus("open");
    const rejoin = transport.last("room.join");
    transport.emit({
      type: "error",
      ...(rejoin ? { replyTo: rejoin.id } : {}),
      payload: { code: "room.full" },
    });
    expect(window.location.hash).toBe("#/");
    expect(screen.getByText(`La sala ${CODE} no tiene asientos libres.`)).toBeDefined();
  });
});

describe("F10f decision 3: «Volver a la sala» opens the screen of the room's state", () => {
  function resume(snap: Snapshot): void {
    const session = memorySession();
    session.saveToken(CODE, TOKEN);
    session.saveNickname("Inés");
    session.saveLastRoom(CODE);
    const transport = fakeTransport();
    const client = new GameClient({ transport, prefs: memoryPrefs(), session });
    render(<Screens client={client} share={{}} />);
    fireEvent.click(screen.getByRole("link", { name: `Volver a la sala ${CODE}` }));
    act(() => {
      navigate({ name: "room", code: CODE });
    });
    welcome(transport, snap);
  }

  it("waiting → lobby", () => {
    resume(snapshot({ state: "waiting", players: [{ ...ME, role: null }] }));
    expect(screen.getByRole("heading", { name: "Sala de espera" })).toBeDefined();
  });

  it("running → the match", () => {
    resume(snapshot({ state: "running" }));
    expect(screen.getByRole("grid", { name: "Tablero" })).toBeDefined();
  });

  it("finished → Resultados", () => {
    resume(snapshot({ state: "finished", ended: true }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Partida sin terminar.");
  });
});
