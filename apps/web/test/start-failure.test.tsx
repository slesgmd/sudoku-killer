// T-37.1: si la entrada o la carga de la partida fallan, o no terminan a tiempo, Entrar muestra un
// aviso con «Reintentar» en lugar de «Entrando…» para siempre, y conserva el apodo y el código.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Screens } from "../src/App.tsx";
import { GameClient, START_TIMEOUT_MS } from "../src/game/client.ts";
import { memoryPrefs } from "../src/game/prefs.ts";
import { memorySession } from "../src/game/session.ts";
import { ME, fakeTransport, type FakeTransport } from "./helpers/ui.tsx";

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", "#/entrar");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, "", "#/");
});

function mountEnter(): { client: GameClient; transport: FakeTransport } {
  const transport = fakeTransport();
  const client = new GameClient({ transport, prefs: memoryPrefs(), session: memorySession() });
  render(<Screens client={client} />);
  return { client, transport };
}

function create(nickname: string): void {
  fireEvent.change(screen.getByLabelText("Tu apodo"), { target: { value: nickname } });
  fireEvent.click(screen.getByRole("button", { name: "Crear sala nueva" }));
}

function join(nickname: string, code: string): void {
  fireEvent.change(screen.getByLabelText("Tu apodo"), { target: { value: nickname } });
  fireEvent.change(screen.getByLabelText("Código de la sala"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
}

function welcome(
  transport: FakeTransport,
  type: "room.create" | "room.join" = "room.create",
): void {
  const entry = transport.last(type);
  transport.emit({
    type: "room.welcome",
    ...(entry ? { replyTo: entry.id } : {}),
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

describe("T-37.1 a failed entry shows «Reintentar» instead of «Entrando…» forever", () => {
  it(`without an answer, after ${String(START_TIMEOUT_MS)} ms; «Reintentar» creates again with the same data`, () => {
    const { transport } = mountEnter();
    create("Inés");
    expect(screen.getByRole("button", { name: /Entrando/ })).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(START_TIMEOUT_MS - 1);
    });
    expect(failure()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(failure()?.textContent).toContain("Sin conexión.");
    expect(screen.queryByRole("button", { name: /Entrando/ })).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("Tu apodo").value).toBe("Inés");

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(transport.sent.filter((m) => m.type === "room.create")).toHaveLength(2);
    expect(transport.last("room.create")?.payload).toEqual({ nickname: "Inés" });
    expect(failure()).toBeNull();
    welcome(transport);
    expect(screen.getByRole("heading", { name: "Sala de espera" })).toBeDefined();
    expect(window.location.hash).toBe("#/sala/HPQ6NZ");
    // En el lobby ya no corre el tiempo límite de la entrada.
    act(() => {
      vi.advanceTimersByTime(START_TIMEOUT_MS * 2);
    });
    expect(screen.getByRole("heading", { name: "Sala de espera" })).toBeDefined();
  });

  it("joining keeps the code, and «Reintentar» joins the same room again", () => {
    const { transport } = mountEnter();
    join("Inés", "hpq6nz");
    expect(transport.last("room.join")?.payload).toEqual({ code: "HPQ6NZ", nickname: "Inés" });
    act(() => {
      vi.advanceTimersByTime(START_TIMEOUT_MS);
    });
    expect(screen.getByLabelText<HTMLInputElement>("Código de la sala").value).toBe("HPQ6NZ");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(transport.sent.filter((m) => m.type === "room.join")).toHaveLength(2);
    expect(transport.last("room.join")?.payload).toEqual({ code: "HPQ6NZ", nickname: "Inés" });
  });

  it("a server error without replyTo while entering fails at once", () => {
    const { transport } = mountEnter();
    create("Inés");
    transport.emit({ type: "error", payload: { code: "server.unavailable" } });
    expect(failure()?.textContent).toContain("Sin conexión.");
    expect(transport.last("room.leave")).toBeUndefined();
  });

  it("a taken nickname is a field error, without «Reintentar»", () => {
    const { transport } = mountEnter();
    create("Inés");
    const entry = transport.last("room.create");
    transport.emit({
      type: "error",
      ...(entry ? { replyTo: entry.id } : {}),
      payload: { code: "nickname.taken" },
    });
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
    expect(failure()?.textContent).toContain("«Inés» ya está en uso");
  });
});

describe("T-37.1 the direct start (create, difficulty and match.start in one go)", () => {
  it("an error for match.start while loading (the puzzle did not load) leaves the room", () => {
    const { client, transport } = mountEnter();
    client.start("Inés", "easy");
    welcome(transport);
    expect(client.getState().phase).toBe("loading");
    const start = transport.last("match.start");
    transport.emit({
      type: "error",
      ...(start ? { replyTo: start.id } : {}),
      payload: { code: "server.unavailable" },
    });
    expect(client.getState().startFailed).toBe(true);
    expect(transport.last("room.leave")).toBeDefined();
    // El tiempo límite ya no corre: no hay un segundo aviso ni otro `room.leave`.
    act(() => {
      vi.advanceTimersByTime(START_TIMEOUT_MS);
    });
    expect(transport.sent.filter((m) => m.type === "room.leave")).toHaveLength(1);
  });

  it("a match that starts in time cancels the time limit", () => {
    const { client, transport } = mountEnter();
    client.start("Inés", "medium");
    welcome(transport);
    expect(transport.last("room.set_difficulty")?.payload).toEqual({ difficulty: "medium" });
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
