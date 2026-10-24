// T-37.1: si la entrada o la carga de la partida fallan, o no terminan a tiempo, el inicio muestra un
// aviso con «Reintentar» en lugar de «Entrando…» para siempre, y conserva el apodo y la dificultad.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Screens } from "../src/App.tsx";
import { GameClient, START_TIMEOUT_MS } from "../src/game/client.ts";
import { memoryPrefs } from "../src/game/prefs.ts";
import { ME, fakeTransport, type FakeTransport } from "./helpers/ui.tsx";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mountHome(): { client: GameClient; transport: FakeTransport } {
  const transport = fakeTransport();
  const client = new GameClient({ transport, prefs: memoryPrefs() });
  render(<Screens client={client} />);
  return { client, transport };
}

function submit(nickname: string, difficulty: RegExp): void {
  fireEvent.change(screen.getByLabelText("Tu apodo"), { target: { value: nickname } });
  fireEvent.click(screen.getByRole("radio", { name: difficulty }));
  fireEvent.click(screen.getByRole("button", { name: "Empezar partida" }));
}

function welcome(transport: FakeTransport): void {
  const create = transport.last("room.create");
  transport.emit({
    type: "room.welcome",
    ...(create ? { replyTo: create.id } : {}),
    payload: {
      playerId: ME.id,
      snapshot: {
        serverNow: 0,
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
}

const failure = () => screen.queryByRole("alert");

describe("T-37.1 a failed start shows «Reintentar» instead of «Entrando…» forever", () => {
  it(`without an answer, after ${String(START_TIMEOUT_MS)} ms; «Reintentar» starts again with the same data`, () => {
    const { transport } = mountHome();
    submit("Inés", /Media/);
    expect(screen.getByRole("button", { name: /Entrando/ })).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(START_TIMEOUT_MS - 1);
    });
    expect(failure()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(failure()?.textContent).toContain("No se pudo empezar.");
    expect(screen.queryByRole("button", { name: /Entrando/ })).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("Tu apodo").value).toBe("Inés");
    expect(screen.getByRole<HTMLInputElement>("radio", { name: /Media/ }).checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(transport.sent.filter((m) => m.type === "room.create")).toHaveLength(2);
    expect(transport.last("room.create")?.payload).toEqual({ nickname: "Inés" });
    expect(failure()).toBeNull();
    welcome(transport);
    expect(transport.last("room.set_difficulty")?.payload).toEqual({ difficulty: "medium" });
    expect(screen.getByText("Cargando la partida…")).toBeDefined();
  });

  it("an error for match.start while loading (the puzzle did not load) leaves the room", () => {
    const { transport } = mountHome();
    submit("Inés", /Fácil/);
    welcome(transport);
    expect(screen.getByText("Cargando la partida…")).toBeDefined();
    const start = transport.last("match.start");
    transport.emit({
      type: "error",
      ...(start ? { replyTo: start.id } : {}),
      payload: { code: "server.unavailable" },
    });
    expect(failure()?.textContent).toContain("Reintentar");
    expect(transport.last("room.leave")).toBeDefined();
    // El tiempo límite ya no corre: no hay un segundo aviso ni otro `room.leave`.
    act(() => {
      vi.advanceTimersByTime(START_TIMEOUT_MS);
    });
    expect(transport.sent.filter((m) => m.type === "room.leave")).toHaveLength(1);
  });

  it("a server error without replyTo while entering fails at once", () => {
    const { transport } = mountHome();
    submit("Inés", /Fácil/);
    transport.emit({ type: "error", payload: { code: "server.unavailable" } });
    expect(failure()?.textContent).toContain("No se pudo empezar.");
    expect(transport.last("room.leave")).toBeUndefined();
  });

  it("a taken nickname is still a field error, without «Reintentar»", () => {
    const { transport } = mountHome();
    submit("Inés", /Fácil/);
    const create = transport.last("room.create");
    transport.emit({
      type: "error",
      ...(create ? { replyTo: create.id } : {}),
      payload: { code: "nickname.taken" },
    });
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
    expect(failure()?.textContent).toContain("apodo");
  });

  it("a match that starts in time cancels the time limit", () => {
    const { client, transport } = mountHome();
    submit("Inés", /Fácil/);
    welcome(transport);
    transport.emit({
      type: "match.started",
      payload: {
        matchId: "m",
        puzzle: {
          id: "p",
          size: 4,
          boxRows: 2,
          boxCols: 2,
          difficulty: "easy",
          cages: [],
          givens: [],
        },
        startedAt: 0,
        hintsLeft: 3,
        players: [ME],
      },
    });
    act(() => {
      vi.advanceTimersByTime(START_TIMEOUT_MS * 2);
    });
    expect(client.getState().phase).toBe("playing");
    expect(transport.last("room.leave")).toBeUndefined();
  });
});
