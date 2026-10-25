// Servidor dormido (F12g, decisión del usuario en el plan de F12): si la conexión no abre en 3 s al
// entrar, Entrar avisa «Despertando el servidor…» y se sigue intentando; el estado `unavailable` no
// corta la entrada; a los 2 min aparece el aviso con «Reintentar». Si abre, el aviso se va y vale el
// plazo normal de 15 s para entrar (T-37.1).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Screens } from "../src/App.tsx";
import {
  GameClient,
  START_TIMEOUT_MS,
  WAKE_NOTICE_MS,
  WAKE_TIMEOUT_MS,
} from "../src/game/client.ts";
import { memoryPrefs } from "../src/game/prefs.ts";
import { memorySession } from "../src/game/session.ts";
import { fakeTransport, type FakeTransport } from "./helpers/ui.tsx";

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", "#/entrar");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, "", "#/");
});

function mountAsleep(): FakeTransport {
  const transport = fakeTransport();
  transport.setStatus("idle");
  const client = new GameClient({ transport, prefs: memoryPrefs(), session: memorySession() });
  render(<Screens client={client} />);
  fireEvent.change(screen.getByLabelText("Tu apodo"), { target: { value: "Inés" } });
  fireEvent.click(screen.getByRole("button", { name: "Crear sala nueva" }));
  transport.setStatus("connecting");
  return transport;
}

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
const waking = () => screen.queryByText("Despertando el servidor…");
const failed = () => screen.queryByRole("button", { name: "Reintentar" });

describe("F12g the server is waking up", () => {
  it(`shows the notice after ${String(WAKE_NOTICE_MS)} ms, keeps trying while unavailable, and offers «Reintentar» after ${String(WAKE_TIMEOUT_MS)} ms`, () => {
    const transport = mountAsleep();
    advance(WAKE_NOTICE_MS - 1);
    expect(waking()).toBeNull();
    advance(1);
    expect(waking()).not.toBeNull();
    transport.setStatus("unavailable");
    advance(WAKE_TIMEOUT_MS - WAKE_NOTICE_MS - 1);
    expect(failed()).toBeNull();
    expect(waking()).not.toBeNull();
    advance(1);
    expect(failed()).not.toBeNull();
    expect(waking()).toBeNull();
  });

  it(`when the server answers the notice goes away and the usual ${String(START_TIMEOUT_MS)} ms apply`, () => {
    const transport = mountAsleep();
    advance(30_000);
    expect(waking()).not.toBeNull();
    transport.setStatus("open");
    expect(waking()).toBeNull();
    expect(transport.last("room.create")?.payload).toEqual({ nickname: "Inés" });
    advance(START_TIMEOUT_MS - 1);
    expect(failed()).toBeNull();
    advance(1);
    expect(failed()).not.toBeNull();
  });

  it("negative check: with the connection already open there is no notice and the usual timeout applies", () => {
    const transport = fakeTransport();
    const client = new GameClient({ transport, prefs: memoryPrefs(), session: memorySession() });
    render(<Screens client={client} />);
    fireEvent.change(screen.getByLabelText("Tu apodo"), { target: { value: "Inés" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear sala nueva" }));
    advance(START_TIMEOUT_MS);
    expect(waking()).toBeNull();
    expect(failed()).not.toBeNull();
  });
});
