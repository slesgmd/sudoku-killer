// El panel de colores de Ajustes, Aleatorio y la negrita de las notas (SPEC, R-42 a R-44), sobre la
// pantalla de partida con un transporte falso.
import type { NoteLayer, PublicPuzzle, Snapshot } from "@sudoku-killer/protocol";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { cageColors } from "../src/game/cage-colors.ts";
import type { GameClient } from "../src/game/client.ts";
import { COLORS_KEY, loadColors } from "../src/game/color-prefs.ts";
import { USE_NOTES_KEY, memoryPrefs } from "../src/game/prefs.ts";
import {
  ME,
  TOMAS,
  cellButton,
  gridCell,
  mountGame,
  testPuzzle,
  type FakeTransport,
} from "./helpers/ui.tsx";

afterEach(() => {
  cleanup();
});

const click = (element: HTMLElement) => {
  fireEvent.click(element);
};
const openSettings = () => {
  click(screen.getByRole("button", { name: "Ajustes" }));
};
const field = (name: string) => screen.getByRole("group", { name });
const swatch = (group: string, color: string) =>
  within(field(group)).getByRole<HTMLInputElement>("radio", { name: color });
const preview = () => {
  const element = document.querySelector<HTMLElement>(".sk-board.preview");
  if (!element) throw new Error("No preview");
  return element;
};
const board = () => {
  const element = document.querySelector<HTMLElement>(".sk-board[role=grid]");
  if (!element) throw new Error("No board");
  return element;
};

describe("T-42.4 the colour selectors work with the keyboard and name each colour", () => {
  it("each selector has Predeterminado first and the nine colours, with their names", () => {
    mountGame();
    openSettings();
    for (const name of ["Jaula", "Suma", "Personal", "Grupal"]) {
      const radios = within(field(name)).getAllByRole<HTMLInputElement>("radio");
      expect(radios).toHaveLength(10);
      expect(radios[0]?.getAttribute("aria-label")).toBe("Predeterminado");
      expect(radios[0]?.checked).toBe(true);
      for (const radio of radios) {
        const label = radio.closest("label");
        expect(label?.getAttribute("title")).toBe(radio.getAttribute("aria-label"));
        expect(radio.nextElementSibling?.classList.contains("dot")).toBe(true);
      }
    }
  });

  it("the arrows choose a colour, and Tab goes to the next selector", async () => {
    const user = userEvent.setup();
    const { client } = mountGame();
    openSettings();
    swatch("Jaula", "Predeterminado").focus();
    await user.keyboard("{ArrowRight}");
    expect(swatch("Jaula", "Frambuesa").checked).toBe(true);
    expect(client.getState().colors.cage).toBe(1);
    await user.keyboard("{ArrowRight}");
    expect(client.getState().colors.cage).toBe(2);
    await user.keyboard("{ArrowLeft}");
    expect(client.getState().colors.cage).toBe(1);
    await user.tab();
    expect(document.activeElement).toBe(swatch("Suma", "Predeterminado"));
  });

  it("negative check: an arrow does not leave the group", async () => {
    const user = userEvent.setup();
    const { client } = mountGame();
    openSettings();
    swatch("Jaula", "Predeterminado").focus();
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(swatch("Jaula", "Vino"));
    expect(client.getState().colors).toMatchObject({ cage: 9, sum: 0, personal: 0, group: 0 });
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(swatch("Jaula", "Predeterminado"));
  });

  it("the first switch still receives the initial focus", () => {
    mountGame();
    openSettings();
    expect(document.activeElement).toBe(screen.getByRole("switch", { name: /^Usar notas/ }));
  });
});

describe("T-42.5 live preview and «Restablecer»", () => {
  it("the preview follows each choice at once, like the board", () => {
    const prefs = memoryPrefs();
    const { client } = mountGame({ prefs });
    openSettings();
    click(swatch("Jaula", "Cobre"));
    click(swatch("Suma", "Bronce"));
    click(swatch("Personal", "Azul"));
    click(swatch("Grupal", "Jade"));
    for (const element of [preview(), board()]) {
      expect(element.getAttribute("data-cage")).toBe("2");
      expect(element.getAttribute("data-sum")).toBe("3");
      expect(element.getAttribute("data-note-personal")).toBe("6");
      expect(element.getAttribute("data-note-group")).toBe("5");
    }
    expect(loadColors(prefs)).toEqual(client.getState().colors);
    expect(prefs.get(COLORS_KEY)).not.toBeNull();
  });

  it("the preview shows a note in bold, and only the visible layers", () => {
    const { client } = mountGame();
    openSettings();
    expect(preview().querySelector(".n.gp.strong")?.textContent).toBe("5");
    act(() => {
      client.toggleVisible("group");
    });
    expect(preview().querySelector(".n.p.strong")?.textContent).toBe("5");
    expect(preview().querySelector(".n.g, .n.gp")).toBeNull();
  });

  it("«Restablecer» returns every colour to Predeterminado, also Aleatorio", () => {
    const prefs = memoryPrefs();
    const { client } = mountGame({ prefs });
    act(() => {
      client.setColors({ random: true, cage: 1, sum: 2, personal: 3, group: 4 });
    });
    openSettings();
    click(screen.getByRole("button", { name: "Restablecer" }));
    expect(client.getState().colors).toMatchObject({
      random: false,
      cage: 0,
      sum: 0,
      personal: 0,
      group: 0,
    });
    expect(loadColors(prefs)).toEqual(client.getState().colors);
    expect(board().getAttribute("data-cage")).toBeNull();
  });

  it("negative check: «Restablecer» does not touch the switches, and nothing is sent", () => {
    const prefs = memoryPrefs();
    const { client, transport } = mountGame({ prefs });
    openSettings();
    click(screen.getByRole("switch", { name: /^Notas personales/ }));
    click(screen.getByRole("switch", { name: /^Usar notas/ }));
    const before = transport.sent.length;
    click(screen.getByRole("button", { name: "Restablecer" }));
    expect(client.getState().personalNotesEnabled).toBe(false);
    expect(client.getState().notesEnabled).toBe(false);
    expect(prefs.get(USE_NOTES_KEY)).toBe("0");
    expect(client.getState().settings.autoCleanPersonalNotes).toBe(true);
    expect(transport.sent.slice(before).filter((m) => m.type !== "sys.ping")).toEqual([]);
  });

  it("control: Predeterminado puts no colour attribute on the board", () => {
    mountGame();
    for (const name of ["data-cage", "data-sum", "data-note-personal", "data-note-group"])
      expect(board().getAttribute(name)).toBeNull();
    expect(board().hasAttribute("data-notes-same")).toBe(false);
  });
});

/** El color de cada jaula en el tablero, por celda. */
const boardColors = () =>
  Array.from(document.querySelectorAll(".sk-board[role=grid] [role=gridcell]")).map((cell) =>
    cell.getAttribute("data-cage-color"),
  );

function snapshotOf(puzzle: PublicPuzzle, atSeq: number): Snapshot {
  return {
    serverNow: 1_000_000,
    atSeq,
    room: {
      code: "HPQ6NZ",
      state: "running",
      starterId: ME.id,
      difficulty: "easy",
      players: [ME, TOMAS],
    },
    match: {
      id: "m1",
      // Un objeto nuevo con el mismo `id`, como el que llega en cada snapshot.
      puzzle: { ...puzzle },
      startedAt: 1_000_000,
      endedAt: null,
      result: null,
      hintsLeft: 3,
      locked: [{ cell: 0, value: 5, source: "given", by: null }],
      groupNotes: [],
      ranking: null,
    },
    you: { playerId: ME.id, settings: { autoCleanPersonalNotes: true }, personalNotes: [] },
  };
}

describe("T-43.2 Aleatorio survives a reconnection", () => {
  it("the same puzzle has the same colours after coming back", () => {
    const { client, transport } = mountGame();
    act(() => {
      client.setColors({ random: true });
    });
    const before = boardColors();
    expect(before.every((color) => color !== null)).toBe(true);
    const puzzle = client.getState().match?.puzzle ?? testPuzzle();

    transport.setStatus("reconnecting");
    transport.setStatus("open");
    const rejoin = transport.last("room.join");
    expect(rejoin).toBeDefined();
    transport.emit({
      type: "room.welcome",
      ...(rejoin ? { replyTo: rejoin.id } : {}),
      payload: { playerId: ME.id, snapshot: snapshotOf(puzzle, 9) },
    });
    expect(client.getState().connection).toBe("open");
    expect(boardColors()).toEqual(before);
  });

  it("negative check: another id gives another assignment", () => {
    const puzzle = testPuzzle();
    expect(cageColors({ ...puzzle, id: "another-puzzle" })).not.toEqual(cageColors(puzzle));
  });
});

describe("T-43.3 Aleatorio joins the cage and the sum, and leaves the notes alone", () => {
  it("Jaula and Suma are disabled; the notes selectors and their colours do not change", () => {
    const { client } = mountGame();
    act(() => {
      client.setColors({ cage: 2, sum: 3, personal: 4, group: 5 });
    });
    openSettings();
    click(screen.getByRole("switch", { name: /^Aleatorio/ }));
    expect(field("Jaula").matches(":disabled")).toBe(true);
    expect(field("Suma").matches(":disabled")).toBe(true);
    expect(field("Personal").matches(":disabled")).toBe(false);
    expect(field("Grupal").matches(":disabled")).toBe(false);
    expect(swatch("Jaula", "Cobre").checked).toBe(true);
    expect(swatch("Suma", "Bronce").checked).toBe(true);

    expect(board().getAttribute("data-cage")).toBeNull();
    expect(board().getAttribute("data-sum")).toBeNull();
    expect(board().getAttribute("data-note-personal")).toBe("4");
    expect(board().getAttribute("data-note-group")).toBe("5");
    expect(boardColors().every((color) => color !== null)).toBe(true);
  });

  it("every cell of a cage has the colour of its cage", () => {
    const { client } = mountGame();
    act(() => {
      client.setColors({ random: true });
    });
    const puzzle = testPuzzle();
    const colors = cageColors(puzzle);
    const cells = boardColors();
    puzzle.cages.forEach((cage, index) => {
      for (const cell of cage.cells) expect(cells[cell]).toBe(String(colors?.[index]));
    });
  });

  it("negative check: on turning it off, what was chosen returns", () => {
    const { client } = mountGame();
    act(() => {
      client.setColors({ cage: 2, sum: 3 });
    });
    openSettings();
    const random = screen.getByRole("switch", { name: /^Aleatorio/ });
    click(random);
    click(random);
    expect(board().getAttribute("data-cage")).toBe("2");
    expect(board().getAttribute("data-sum")).toBe("3");
    expect(boardColors().every((color) => color === null)).toBe(true);
    expect(field("Jaula").matches(":disabled")).toBe(false);
  });
});

/** Escribe una nota y la confirma como lo haría el servidor. */
function writeNote(
  client: GameClient,
  transport: FakeTransport,
  layer: NoteLayer,
  cell: number,
  digit: number,
) {
  act(() => {
    client.setMode("notes");
    client.setLayer(layer);
    client.select(cell);
    client.input(digit);
  });
  const sent = transport.last("note.add");
  transport.emit({
    type: "note.applied",
    seq: transport.sent.length + 10,
    replyTo: sent?.id ?? "",
    payload: { opSeq: transport.sent.length + 10, layer, op: "add", cell, digit, by: ME.id },
  });
}

const strongIn = (row: number, col: number) =>
  Array.from(gridCell(row, col).querySelectorAll(".n.strong")).map((note) => note.textContent);

describe("T-44.1 the notes of the selected digit go bold", () => {
  it("only while a placed digit is selected, and they return when the selection changes", () => {
    const { client, transport } = mountGame();
    writeNote(client, transport, "group", 10, 5);
    writeNote(client, transport, "group", 10, 7);
    writeNote(client, transport, "personal", 11, 5);
    click(cellButton(1, 1)); // El 5 inicial.
    expect(strongIn(2, 2)).toEqual(["5"]);
    expect(strongIn(2, 3)).toEqual(["5"]);

    click(cellButton(3, 3));
    expect(strongIn(2, 2)).toEqual([]);
    expect(strongIn(2, 3)).toEqual([]);
  });

  it("follows a digit that a teammate has just placed", () => {
    const { client, transport } = mountGame();
    writeNote(client, transport, "group", 10, 7);
    transport.emit({
      type: "cell.solved",
      seq: 90,
      payload: { cell: 40, value: 7, by: TOMAS.id, points: 10, score: 10, bonuses: [] },
    });
    click(cellButton(5, 5));
    expect(strongIn(2, 2)).toEqual(["7"]);
  });

  it("negative check: an empty selected cell turns on nothing, not even with its own notes", () => {
    const { client, transport } = mountGame();
    writeNote(client, transport, "group", 10, 5);
    click(cellButton(2, 2));
    expect(strongIn(2, 2)).toEqual([]);
    click(cellButton(3, 3));
    expect(document.querySelector(".sk-board[role=grid] .n.strong")).toBeNull();
  });

  it("negative check: with the match over there is no selection and no bold", () => {
    const { client, transport } = mountGame();
    writeNote(client, transport, "group", 10, 5);
    click(cellButton(1, 1));
    expect(strongIn(2, 2)).toEqual(["5"]);
    transport.emit({
      type: "match.ended",
      seq: 99,
      payload: {
        result: "victory",
        defeatCause: null,
        endedAt: 1_100_000,
        ranking: [],
        players: [ME],
      },
    } as never);
    expect(client.getState().phase).toBe("ended");
    expect(strongIn(2, 2)).toEqual([]);
  });
});

describe("T-44.2 only the visible notes go bold", () => {
  function twoLayers() {
    const mounted = mountGame();
    writeNote(mounted.client, mounted.transport, "personal", 10, 5);
    writeNote(mounted.client, mounted.transport, "group", 11, 5);
    click(cellButton(1, 1));
    return mounted;
  }

  it("with the preference off, the personal notes do not receive it", () => {
    const { client } = twoLayers();
    expect(strongIn(2, 2)).toEqual(["5"]);
    expect(strongIn(2, 3)).toEqual(["5"]);
    act(() => {
      client.setPersonalNotesEnabled(false);
    });
    expect(strongIn(2, 2)).toEqual([]);
    expect(strongIn(2, 3)).toEqual(["5"]);
  });

  it("with the eye of a layer off, that layer does not receive it", () => {
    const { client } = twoLayers();
    act(() => {
      client.toggleVisible("group");
    });
    expect(strongIn(2, 2)).toEqual(["5"]);
    expect(strongIn(2, 3)).toEqual([]);
    act(() => {
      client.toggleVisible("group");
      client.toggleVisible("personal");
    });
    expect(strongIn(2, 2)).toEqual([]);
    expect(strongIn(2, 3)).toEqual(["5"]);
  });

  it("negative check: with «Usar notas» off there is none", () => {
    const { client } = twoLayers();
    act(() => {
      client.setNotesEnabled(false);
    });
    expect(document.querySelector(".sk-board .n.strong")).toBeNull();
  });
});
