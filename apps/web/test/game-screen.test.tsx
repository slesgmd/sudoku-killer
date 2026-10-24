// Pruebas de componentes de la pantalla de partida (nivel C de la SPEC, F8). Cada una cita su T. La
// prueba hace de servidor con un transporte falso y comprueba lo que se ve y lo que se envía.
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { PARAMS_V1 } from "@sudoku-killer/scoring";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_FLASH_MS } from "../src/game/client.ts";
import { ME, TOMAS, cellButton, gridCell, mountGame } from "./helpers/ui.tsx";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const click = (element: HTMLElement) => {
  fireEvent.click(element);
};
const button = (name: string | RegExp) => screen.getByRole("button", { name });

describe("T-04.3 the wrong digit is shown with its author for an instant", () => {
  it(`shows the struck digit and the author's initial for ${String(ERROR_FLASH_MS)} ms, then empties the cell`, () => {
    const { transport } = mountGame();
    transport.emit({
      type: "cell.mistake",
      seq: 2,
      payload: {
        cell: 10,
        digit: 3,
        by: TOMAS.id,
        points: -90,
        score: -90,
        livesLeft: 2,
        role: "active",
      },
    });
    const cell = gridCell(2, 2);
    expect(cell.classList.contains("err")).toBe(true);
    expect(within(cell).getByText("3")).toBeTruthy();
    expect(within(cell).getByText("T")).toBeTruthy();
    expect(cellButton(2, 2).getAttribute("aria-label")).toMatch(
      /vacía; Tomás acaba de fallar con un 3$/,
    );

    act(() => {
      vi.advanceTimersByTime(ERROR_FLASH_MS - 1);
    });
    expect(gridCell(2, 2).classList.contains("err")).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(gridCell(2, 2).classList.contains("err")).toBe(false);
    expect(cellButton(2, 2).getAttribute("aria-label")).toMatch(/, vacía$/);
  });
});

describe("T-06.1 note layers: view and write selectors", () => {
  it("each eye hides and shows its layer, and the write layer sets the layer that is sent", () => {
    const { transport } = mountGame();
    click(cellButton(2, 2));
    click(button("Notas"));

    click(button(/^Nota 1,/));
    const personal = transport.last("note.add");
    expect(personal?.payload).toEqual({ layer: "personal", cell: 10, digit: 1 });
    transport.emit({
      type: "note.applied",
      seq: 2,
      replyTo: personal?.id ?? "",
      payload: { opSeq: 2, layer: "personal", op: "add", cell: 10, digit: 1, by: ME.id },
    });

    click(button("Grupal"));
    click(button(/^Nota 2,/));
    const group = transport.last("note.add");
    expect(group?.payload).toEqual({ layer: "group", cell: 10, digit: 2 });
    transport.emit({
      type: "note.applied",
      seq: 3,
      replyTo: group?.id ?? "",
      payload: { opSeq: 3, layer: "group", op: "add", cell: 10, digit: 2, by: ME.id },
    });

    const label = () => cellButton(2, 2).getAttribute("aria-label") ?? "";
    expect(label()).toMatch(/notas grupales 2, notas personales 1/);

    const eyePersonal = button("Notas personales");
    click(eyePersonal);
    expect(eyePersonal.getAttribute("aria-pressed")).toBe("false");
    expect(label()).toMatch(/notas grupales 2$/);

    const eyeGroup = button("Notas grupales");
    click(eyeGroup);
    expect(label()).toMatch(/, vacía$/);

    click(eyePersonal);
    expect(label()).toMatch(/vacía, notas personales 1$/);
  });
});

describe("T-07.2 the timer matches the server clock despite a skewed client clock", () => {
  it("with the client 10 minutes ahead, the timer shows the server time (±1 s) after sys.ping", () => {
    const serverStart = new Date("2026-10-24T12:00:00Z").getTime();
    vi.setSystemTime(serverStart + 65_000);
    const skew = 10 * 60_000;
    // El snapshot llega con una hora vieja (30 s antes): el desfase bueno lo da sys.ping.
    const { transport } = mountGame({
      now: () => Date.now() + skew,
      startedAt: serverStart,
      serverNow: Date.now() - 30_000,
    });
    const ping = transport.last("sys.ping");
    expect(ping).toBeDefined();
    vi.advanceTimersByTime(40);
    transport.emit({
      type: "sys.pong",
      payload: { t0: ping?.payload.t0 ?? 0, serverNow: Date.now() - 20 },
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    const shown = screen.getByRole("timer").textContent;
    const [minutes, seconds] = shown.split(":").map(Number);
    const serverElapsed = (Date.now() - serverStart) / 1000;
    expect(Math.abs((minutes ?? 0) * 60 + (seconds ?? 0) - serverElapsed)).toBeLessThanOrEqual(1);
  });
});

describe("T-24.3 presence of team-mates", () => {
  it("shows the cell selected by a team-mate, with their initial", () => {
    const { transport } = mountGame();
    transport.emit({ type: "presence.updated", payload: { playerId: TOMAS.id, cell: 40 } });
    const cell = gridCell(5, 5);
    expect(cell.querySelector(".pres")).not.toBeNull();
    expect(cell.querySelector(".ptag")?.textContent).toBe("T");
    expect(cellButton(5, 5).getAttribute("aria-label")).toMatch(/Tomás está aquí$/);
  });
});

describe("T-25.2 undo of a group note that someone else changed", () => {
  it("shows a notice and leaves the notes as they are", () => {
    const { transport } = mountGame();
    click(cellButton(2, 2));
    click(button("Notas"));
    click(button("Grupal"));
    click(button(/^Nota 4,/));
    const add = transport.last("note.add");
    transport.emit({
      type: "note.applied",
      seq: 7,
      replyTo: add?.id ?? "",
      payload: { opSeq: 7, layer: "group", op: "add", cell: 10, digit: 4, by: ME.id },
    });
    click(button("Deshacer tus últimas notas"));
    const undo = transport.last("note.undo");
    expect(undo?.payload).toEqual({ opSeq: 7 });
    transport.emit({
      type: "error",
      replyTo: undo?.id ?? "",
      payload: { code: "undo.not_applicable", reason: "modified" },
    });
    expect(
      screen.getByText("No se pudo deshacer: otra persona cambió esa nota grupal después."),
    ).toBeTruthy();
    expect(cellButton(2, 2).getAttribute("aria-label")).toMatch(/notas grupales 4$/);
  });
});

describe("T-28.2 an evident mistake is not blocked", () => {
  it("a digit repeating a locked peer can still be typed and is sent to the server", () => {
    const { transport } = mountGame();
    // La celda 0 tiene un 5 inicial; la 1 es de su fila, su caja y su jaula.
    click(cellButton(1, 2));
    const key = button(/^Número 5,/);
    expect(key.getAttribute("aria-disabled")).toBeNull();
    click(key);
    expect(transport.last("cell.place")?.payload).toEqual({ cell: 1, digit: 5 });
    expect(cellButton(1, 2).getAttribute("aria-label")).toMatch(/5, pendiente de confirmación/);
  });
});

describe("T-33.1 the selected cell's cage is highlighted", () => {
  it("highlights the cage as well as the row, the column and the box", () => {
    mountGame();
    click(cellButton(3, 3));
    const related = (row: number, col: number) => gridCell(row, col).dataset["related"] === "true";
    expect(related(3, 9)).toBe(true); // fila
    expect(related(9, 3)).toBe(true); // columna
    expect(related(1, 1)).toBe(true); // caja
    expect(related(4, 4)).toBe(true); // jaula, fuera de la fila, la columna y la caja
    expect(related(5, 5)).toBe(false);
    expect(gridCell(4, 4).querySelector(".cg.hot")).not.toBeNull();
    expect(gridCell(5, 5).querySelector(".cg.hot")).toBeNull();
    expect(gridCell(3, 3).getAttribute("aria-selected")).toBe("true");
  });
});

describe("dialogs (docs/diseno.md §5.7 and §9)", () => {
  it("the hint confirmation shows H from the scoring parameters and starts on Cancelar", () => {
    const { transport } = mountGame();
    click(cellButton(2, 2));
    click(button(/^Pista, quedan 3/));
    const dialog = screen.getByRole("dialog", { name: "¿Usar una pista en F2 C2?" });
    expect(
      within(dialog).getByText(
        `Cuesta −${String(PARAMS_V1.hintPenalty)} puntos a quien la usa y no da bonus.`,
      ),
    ).toBeTruthy();
    expect(document.activeElement?.textContent).toBe("Cancelar");
    click(within(dialog).getByRole("button", { name: "Usar pista" }));
    expect(transport.last("hint.use")?.payload).toEqual({ cell: 10 });
  });

  it("Ajustes starts on the switch, and closing returns the focus to the button that opened it", () => {
    mountGame();
    const opener = button("Ajustes");
    opener.focus();
    click(opener);
    expect(document.activeElement?.getAttribute("role")).toBe("switch");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("decision 2: the hand-over notice appears only for the player who can start", () => {
    const { transport } = mountGame();
    click(button("Salir"));
    expect(
      screen.getByText("El derecho de iniciar pasará a Tomás y no vuelve a ti aunque regreses."),
    ).toBeTruthy();
    expect(document.activeElement?.textContent).toBe("Quedarme");
    click(button("Quedarme"));
    transport.emit({ type: "room.starter_changed", payload: { playerId: TOMAS.id } });
    click(button("Salir"));
    expect(screen.queryByText(/El derecho de iniciar pasará/)).toBeNull();
  });
});
