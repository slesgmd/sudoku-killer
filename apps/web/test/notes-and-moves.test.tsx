// Ajustes de la prueba en celular: la preferencia local «Usar notas» (T-06.3) y la jugada
// inmediata (el dígito pendiente se ve en el mismo ciclo del evento, sin optimismo sobre el
// resultado).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { USE_NOTES_KEY, memoryPrefs } from "../src/game/prefs.ts";
import { createHarness, type SimHarness } from "./helpers/sim.ts";
import { Screen, cellButton, mountGame } from "./helpers/ui.tsx";

afterEach(() => {
  cleanup();
});

const notesControls = () => [
  screen.queryByRole("button", { name: "Número" }),
  screen.queryByRole("button", { name: "Notas" }),
  screen.queryByRole("button", { name: "Personal" }),
  screen.queryByRole("button", { name: "Grupal" }),
  screen.queryByRole("button", { name: "Notas personales" }),
  screen.queryByRole("button", { name: "Notas grupales" }),
  screen.queryByRole("button", { name: /^Borrar las notas/ }),
];

describe("T-06.3 «Usar notas» is a local client preference", () => {
  it("off: no note control is shown, and the note shortcuts send nothing", () => {
    const { transport } = mountGame({ prefs: memoryPrefs({ [USE_NOTES_KEY]: "0" }) });
    expect(notesControls().filter((control) => control !== null)).toEqual([]);

    fireEvent.click(cellButton(2, 2));
    const before = transport.sent.length;
    for (const key of ["n", "g", "Delete", "Backspace"]) fireEvent.keyDown(window, { key });
    expect(transport.sent.slice(before)).toEqual([]);

    // Los números siguen funcionando, y nunca como nota.
    fireEvent.keyDown(window, { key: "3" });
    expect(transport.sent.slice(before).map((m) => m.type)).toEqual(["cell.place"]);
    expect(screen.getByRole("button", { name: /^Número 3,/ })).toBeTruthy();
  });

  it("is switched in Ajustes, stored only in the browser and never sent to the server", () => {
    const prefs = memoryPrefs();
    const { transport } = mountGame({ prefs });
    expect(screen.getByRole("button", { name: "Notas" })).toBeTruthy();
    const before = transport.sent.length;
    fireEvent.click(screen.getByRole("button", { name: "Ajustes" }));
    const toggle = screen.getByRole("switch", { name: /^Usar notas/ });
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);
    fireEvent.keyDown(toggle, { key: "Escape" });
    expect(prefs.get(USE_NOTES_KEY)).toBe("0");
    expect(transport.sent.slice(before)).toEqual([]);
    expect(notesControls().filter((control) => control !== null)).toEqual([]);
  });
});

describe("immediate move: the pending digit shows in the same cycle, with ?lat=120", () => {
  let harness: SimHarness | null = null;
  afterEach(() => {
    harness?.client.destroy();
    harness = null;
  });

  /** Partida contra el servidor simulado, con relojes reales y 120 ms de latencia. */
  async function startMatch(): Promise<SimHarness> {
    const created = createHarness({ latencyMs: 120 });
    render(<Screen client={created.client} />);
    act(() => {
      created.client.start("Inés", "easy");
    });
    await vi.waitFor(
      () => {
        expect(created.client.getState().phase).toBe("playing");
      },
      { timeout: 10_000, interval: 50 },
    );
    return created;
  }

  it("keyboard and touch: digit pending at once; lives, points and lock wait for the verdict", async () => {
    harness = await startMatch();
    const { client } = harness;
    const solution = harness.solution();
    const empty = client.getState().locked.flatMap((cell, i) => (cell ? [] : [i]));
    const [first, second] = empty;
    if (first === undefined || second === undefined) throw new Error("No empty cells");
    const button = (cell: number) => cellButton(Math.floor(cell / 9) + 1, (cell % 9) + 1);

    // Teclado: un dígito incorrecto.
    button(first).click();
    const wrong = ((solution[first] ?? 1) % 9) + 1;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: String(wrong) }));
    expect(button(first).getAttribute("aria-label")).toMatch(
      new RegExp(`, ${String(wrong)}, pendiente de confirmación`),
    );
    expect(client.getState().players[0]).toMatchObject({ lives: 3, score: 0 });

    // Toque: el dígito correcto en otra celda.
    button(second).click();
    screen
      .getByRole("button", { name: new RegExp(`^Número ${String(solution[second])},`) })
      .click();
    expect(button(second).getAttribute("aria-label")).toMatch(/pendiente de confirmación/);
    expect(client.getState().locked[second]).toBeNull();

    // El veredicto: error con destello en la primera, bloqueo en la segunda.
    await vi.waitFor(
      () => {
        expect(button(first).getAttribute("aria-label")).toMatch(/acaba de fallar con un/);
        expect(button(second).getAttribute("aria-label")).toMatch(/resuelta por ti/);
      },
      { timeout: 3_000, interval: 20 },
    );
    expect(client.getState().players[0]).toMatchObject({ lives: 2 });
  });
});
