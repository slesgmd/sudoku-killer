// La preferencia «Notas personales» y el aviso al escribir en una capa oculta (SPEC, R-42): la
// preferencia se guarda y es distinta del ojo de cada capa, que dura solo la sesión.
import type { NoteLayer } from "@sudoku-killer/protocol";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameClient } from "../src/game/client.ts";
import { PERSONAL_NOTES_KEY, USE_NOTES_KEY, memoryPrefs, type Prefs } from "../src/game/prefs.ts";
import { memorySession } from "../src/game/session.ts";
import { writeLayer } from "../src/game/state.ts";
import {
  ME,
  cellButton,
  fakeTransport,
  gridCell,
  mountGame,
  type FakeTransport,
} from "./helpers/ui.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const HIDDEN_PERSONAL = "Las notas personales están ocultas. Muéstralas con el ojo para escribir.";
const HIDDEN_GROUP = "Las notas grupales están ocultas. Muéstralas con el ojo para escribir.";

const click = (element: HTMLElement) => {
  fireEvent.click(element);
};
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const eye = (layer: NoteLayer) =>
  button(layer === "personal" ? "Notas personales" : "Notas grupales");

function openSettings() {
  click(button("Ajustes"));
}
function closeSettings() {
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
}
const personalSwitch = () => screen.getByRole("switch", { name: /^Notas personales/ });

/** Apaga o enciende «Notas personales» desde Ajustes. */
function setPreference(checked: boolean) {
  openSettings();
  if (personalSwitch().getAttribute("aria-checked") !== String(checked)) click(personalSwitch());
  closeSettings();
}

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
    payload: {
      opSeq: transport.sent.length + 10,
      layer,
      op: "add",
      cell,
      digit,
      by: ME.id,
    },
  });
}

/** Lo enviado desde `from`, sin los pings. */
const sentFrom = (transport: FakeTransport, from: number) =>
  transport.sent.slice(from).filter((m) => m.type !== "sys.ping");

const toastsOf = (client: GameClient, text: string) =>
  client.getState().toasts.filter((toast) => toast.text === text);

const deleteKeys = () => {
  fireEvent.keyDown(window, { key: "Delete" });
  fireEvent.keyDown(window, { key: "Backspace" });
};

describe("T-42.10 the «Notas personales» preference and the eye are independent", () => {
  it("switching the preference leaves the eye alone", () => {
    const { client } = mountGame();
    setPreference(false);
    expect(client.getState().personalNotesEnabled).toBe(false);
    expect(client.getState().visible.personal).toBe(true);
    setPreference(true);
    expect(eye("personal").getAttribute("aria-pressed")).toBe("true");
  });

  it("switching the eye leaves the preference alone, and an eye that is off stays off", () => {
    const prefs = memoryPrefs();
    const { client } = mountGame({ prefs });
    click(eye("personal"));
    expect(eye("personal").getAttribute("aria-pressed")).toBe("false");
    expect(client.getState().personalNotesEnabled).toBe(true);
    expect(prefs.get(PERSONAL_NOTES_KEY)).toBeNull();
    openSettings();
    expect(personalSwitch().getAttribute("aria-checked")).toBe("true");
    closeSettings();

    setPreference(false);
    setPreference(true);
    expect(eye("personal").getAttribute("aria-pressed")).toBe("false");
    expect(client.getState().visible.personal).toBe(false);
  });

  it("negative check: neither sends any message, not even settings.update", () => {
    const { transport } = mountGame();
    const before = transport.sent.length;
    click(eye("personal"));
    click(eye("personal"));
    setPreference(false);
    setPreference(true);
    expect(sentFrom(transport, before)).toEqual([]);
    expect(transport.last("settings.update")).toBeUndefined();
  });
});

describe("T-42.11 the preference is stored and the eyes are not", () => {
  const newClient = (prefs: Prefs) =>
    new GameClient({ transport: fakeTransport(), prefs, session: memorySession() });

  it("is on by default, also with a value it does not understand", () => {
    expect(newClient(memoryPrefs()).getState().personalNotesEnabled).toBe(true);
    for (const value of ["1", "", "off", "false", "null"]) {
      const prefs = memoryPrefs({ [PERSONAL_NOTES_KEY]: value });
      expect(newClient(prefs).getState().personalNotesEnabled).toBe(true);
    }
  });

  it("is kept after reloading, entering a room, going home and going back to the lobby", () => {
    const prefs = memoryPrefs();
    const { client, transport } = mountGame({ prefs });
    act(() => {
      client.setPersonalNotesEnabled(false);
    });
    expect(prefs.get(PERSONAL_NOTES_KEY)).toBe("0");
    expect(newClient(prefs).getState().personalNotesEnabled).toBe(false);

    transport.emit({
      type: "match.ended",
      seq: 50,
      payload: {
        result: "victory",
        defeatCause: null,
        endedAt: 1_100_000,
        ranking: [],
        players: [ME],
      },
    } as never);
    transport.emit({ type: "room.state_changed", seq: 51, payload: { state: "waiting" } });
    expect(client.getState().phase).toBe("lobby");
    expect(client.getState().personalNotesEnabled).toBe(false);

    act(() => {
      client.backHome();
    });
    expect(client.getState().personalNotesEnabled).toBe(false);
    act(() => {
      client.start("Inés", "easy");
    });
    expect(client.getState().phase).toBe("entering");
    expect(client.getState().personalNotesEnabled).toBe(false);
  });

  it("the colours are kept in the same places", () => {
    const prefs = memoryPrefs();
    const { client } = mountGame({ prefs });
    act(() => {
      client.setColors({ cage: 3, personal: 2 });
    });
    const colors = client.getState().colors;
    expect(newClient(prefs).getState().colors).toEqual(colors);
    act(() => {
      client.backHome();
    });
    expect(client.getState().colors).toEqual(colors);
    act(() => {
      client.start("Inés", "easy");
    });
    expect(client.getState().colors).toEqual(colors);
  });

  it("negative check: the eyes store nothing and come back after entering a room", () => {
    const written: string[] = [];
    const inner = memoryPrefs();
    const prefs: Prefs = {
      get: (key) => inner.get(key),
      set: (key, value) => {
        written.push(key);
        inner.set(key, value);
      },
    };
    const { client } = mountGame({ prefs });
    click(eye("personal"));
    click(eye("group"));
    expect(client.getState().visible).toEqual({ personal: false, group: false });
    expect(written).toEqual([]);
    expect(newClient(prefs).getState().visible).toEqual({ personal: true, group: true });
    act(() => {
      client.backHome();
    });
    expect(client.getState().visible).toEqual({ personal: true, group: true });
    act(() => {
      client.toggleVisible("personal");
      client.start("Inés", "easy");
    });
    expect(client.getState().visible).toEqual({ personal: true, group: true });
  });
});

describe("T-42.12 with the preference off, notes are written in the group layer", () => {
  it("keys and «Borrar» send the group layer, and the label of «Borrar» says so", () => {
    const { client, transport } = mountGame();
    click(cellButton(2, 2));
    click(button("Notas"));
    setPreference(false);
    expect(writeLayer(client.getState())).toBe("group");
    expect(button(/^Borrar las notas/).getAttribute("aria-label")).toMatch(/grupal/);

    click(button(/^Nota 1,/));
    const added = transport.last("note.add");
    expect(added?.payload).toEqual({ layer: "group", cell: 10, digit: 1 });
    transport.emit({
      type: "note.applied",
      seq: 2,
      replyTo: added?.id ?? "",
      payload: { opSeq: 2, layer: "group", op: "add", cell: 10, digit: 1, by: ME.id },
    });

    fireEvent.keyDown(window, { key: "2" });
    expect(transport.last("note.add")?.payload).toEqual({ layer: "group", cell: 10, digit: 2 });

    click(button(/^Borrar las notas/));
    expect(transport.last("note.remove")?.payload).toMatchObject({ layer: "group", cell: 10 });
  });

  it("turning it back on returns to state.layer: «Personal» if it was the layer", () => {
    const { client, transport } = mountGame();
    click(cellButton(2, 2));
    click(button("Notas"));
    setPreference(false);
    setPreference(true);
    expect(client.getState().layer).toBe("personal");
    expect(writeLayer(client.getState())).toBe("personal");
    expect(button("Personal").getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(window, { key: "4" });
    expect(transport.last("note.add")?.payload).toEqual({ layer: "personal", cell: 10, digit: 4 });
  });

  it("turning it back on returns to «Grupal» if that was the layer", () => {
    const { client } = mountGame();
    click(button("Notas"));
    click(button("Grupal"));
    setPreference(false);
    setPreference(true);
    expect(client.getState().layer).toBe("group");
    expect(writeLayer(client.getState())).toBe("group");
  });

  it("negative check: G and setLayer do not change state.layer, and nothing goes to the personal layer", () => {
    const { client, transport } = mountGame();
    click(cellButton(2, 2));
    click(button("Notas"));
    setPreference(false);
    fireEvent.keyDown(window, { key: "g" });
    expect(client.getState().layer).toBe("personal");
    act(() => {
      client.setLayer("group");
    });
    expect(client.getState().layer).toBe("personal");
    fireEvent.keyDown(window, { key: "3" });
    const personal = transport.sent.filter(
      (m) => (m.type === "note.add" || m.type === "note.remove") && m.payload.layer === "personal",
    );
    expect(personal).toEqual([]);
  });

  it("control: with the preference on, G still switches the layer", () => {
    const { client } = mountGame();
    fireEvent.keyDown(window, { key: "g" });
    expect(client.getState().layer).toBe("group");
    fireEvent.keyDown(window, { key: "g" });
    expect(client.getState().layer).toBe("personal");
  });
});

describe("T-42.13 with the preference off, personal notes are kept out of sight", () => {
  const field = (name: string) => screen.getByRole("group", { name });

  it("the personal selector is disabled, the group one is active and the preview has no personal notes", () => {
    const { client } = mountGame();
    act(() => {
      client.setColors({ personal: 4 });
    });
    openSettings();
    const preview = document.querySelector(".sk-board.preview");
    expect(preview?.querySelector(".n.p, .n.gp")).not.toBeNull();
    click(personalSwitch());
    expect(field("Personal").matches(":disabled")).toBe(true);
    expect(field("Grupal").matches(":disabled")).toBe(false);
    expect(preview?.querySelector(".n.p, .n.gp")).toBeNull();
    expect(preview?.querySelector(".n.g")).not.toBeNull();

    const chosen = within(field("Personal")).getByRole<HTMLInputElement>("radio", {
      name: "Bosque",
    });
    expect(chosen.checked).toBe(true);
  });

  it("«Limpiar notas personales» stays active and still reaches the server", () => {
    const { transport } = mountGame();
    setPreference(false);
    openSettings();
    const clean = screen.getByRole("switch", { name: /^Limpiar notas personales/ });
    expect(clean.getAttribute("aria-disabled")).toBeNull();
    click(clean);
    expect(transport.last("settings.update")?.payload).toEqual({ autoCleanPersonalNotes: false });
  });

  it("negative check: no note is removed, and the notes and the colour come back", () => {
    const { client, transport } = mountGame();
    writeNote(client, transport, "personal", 10, 1);
    act(() => {
      client.setColors({ personal: 6 });
    });
    const label = () => cellButton(2, 2).getAttribute("aria-label") ?? "";
    expect(label()).toMatch(/notas personales 1$/);

    setPreference(false);
    expect(label()).toMatch(/, vacía$/);
    expect(transport.last("note.remove")).toBeUndefined();

    setPreference(true);
    expect(label()).toMatch(/notas personales 1$/);
    expect(client.getState().colors.personal).toBe(6);
  });
});

describe("T-42.14 «Usar notas» off rules over everything", () => {
  const field = (name: string) => screen.getByRole("group", { name });

  it("no notes and no notices; the switch and the note selectors are disabled", () => {
    const { client, transport } = mountGame({ prefs: memoryPrefs({ [USE_NOTES_KEY]: "0" }) });
    click(cellButton(2, 2));
    const before = transport.sent.length;
    act(() => {
      client.toggleVisible("personal");
      client.toggleVisible("group");
    });
    deleteKeys();
    expect(sentFrom(transport, before)).toEqual([]);
    expect(client.getState().toasts).toEqual([]);
    expect(document.querySelector(".sk-board .n.g, .sk-board .n.p")).toBeNull();

    openSettings();
    expect(personalSwitch().getAttribute("aria-disabled")).toBe("true");
    expect(field("Personal").matches(":disabled")).toBe(true);
    expect(field("Grupal").matches(":disabled")).toBe(true);
    expect(field("Jaula").matches(":disabled")).toBe(false);
    expect(field("Suma").matches(":disabled")).toBe(false);
    expect(document.querySelector(".sk-board.preview .n.g, .sk-board.preview .n.p")).toBeNull();
  });

  it("notes already written disappear from the board and from the preview, with the eyes on", () => {
    const { client, transport } = mountGame();
    writeNote(client, transport, "personal", 10, 1);
    writeNote(client, transport, "group", 11, 2);
    expect(gridCell(2, 2).querySelector(".n.p")).not.toBeNull();
    expect(gridCell(2, 3).querySelector(".n.g")).not.toBeNull();
    openSettings();
    expect(document.querySelector(".sk-board.preview .n.g")).not.toBeNull();
    click(screen.getByRole("switch", { name: /^Usar notas/ }));
    expect(client.getState().visible).toEqual({ personal: true, group: true });
    expect(document.querySelector(".sk-board .n.p, .sk-board .n.g, .sk-board .n.gp")).toBeNull();
  });

  it("negative check: the switch does not change the preference, and everything returns", () => {
    const prefs = memoryPrefs({ [PERSONAL_NOTES_KEY]: "0" });
    const { client } = mountGame({ prefs });
    act(() => {
      client.setColors({ personal: 2, group: 3 });
    });
    openSettings();
    const useNotes = screen.getByRole("switch", { name: /^Usar notas/ });
    click(useNotes);
    click(personalSwitch());
    expect(prefs.get(PERSONAL_NOTES_KEY)).toBe("0");
    expect(client.getState().personalNotesEnabled).toBe(false);

    click(useNotes);
    expect(personalSwitch().getAttribute("aria-disabled")).toBeNull();
    expect(personalSwitch().getAttribute("aria-checked")).toBe("false");
    expect(field("Grupal").matches(":disabled")).toBe(false);
    expect(client.getState().colors).toMatchObject({ personal: 2, group: 3 });
  });
});

describe("T-42.15 with the preference off, the personal controls are not in the page", () => {
  const present = () => ({
    personalEye: screen.queryByRole("button", { name: "Notas personales" }) !== null,
    personalLayer: screen.queryByRole("button", { name: "Personal" }) !== null,
    groupEye: screen.queryByRole("button", { name: "Notas grupales" }) !== null,
    groupLayer: screen.queryByRole("button", { name: "Grupal" }) !== null,
  });
  const ALL = { personalEye: true, personalLayer: true, groupEye: true, groupLayer: true };
  const GROUP = { personalEye: false, personalLayer: false, groupEye: true, groupLayer: true };

  it("LayersWide, on a desktop", () => {
    mountGame();
    click(button("Notas"));
    expect(document.querySelector(".visrow")).not.toBeNull();
    expect(present()).toEqual(ALL);
    setPreference(false);
    expect(present()).toEqual(GROUP);
    expect(document.querySelector(".visrow.one")).not.toBeNull();
    setPreference(true);
    expect(present()).toEqual(ALL);
  });

  it("LayersCompact, on a phone", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const { client } = mountGame();
    expect(document.querySelector(".layers")).not.toBeNull();
    expect(present()).toEqual(ALL);
    act(() => {
      client.setPersonalNotesEnabled(false);
    });
    expect(present()).toEqual(GROUP);
    expect(document.querySelector(".layers.one")).not.toBeNull();
    act(() => {
      client.setPersonalNotesEnabled(true);
    });
    expect(present()).toEqual(ALL);
  });
});

describe("T-42.16 with the eye of the active layer off, a note is not written", () => {
  it("the key sends nothing, leaves nothing pending and shows the notice of that layer once", () => {
    const { client, transport } = mountGame();
    click(cellButton(2, 2));
    click(button("Notas"));
    click(eye("personal"));
    const before = transport.sent.length;

    fireEvent.keyDown(window, { key: "1" });
    click(button(/^Nota 2,/));

    expect(sentFrom(transport, before)).toEqual([]);
    expect(client.getState().pendingNotes).toEqual([]);
    expect(toastsOf(client, HIDDEN_PERSONAL)).toHaveLength(1);
    expect(client.getState().activity.filter((a) => a.text === HIDDEN_PERSONAL)).toHaveLength(1);
    expect(document.querySelector(".toast")?.textContent).toBe(HIDDEN_PERSONAL);
  });

  it("the group layer has its own notice, and it can come back once the first one is gone", () => {
    const { client, transport } = mountGame();
    click(cellButton(2, 2));
    click(button("Notas"));
    click(button("Grupal"));
    click(eye("group"));
    const before = transport.sent.length;
    fireEvent.keyDown(window, { key: "1" });
    const [toast] = toastsOf(client, HIDDEN_GROUP);
    if (!toast) throw new Error("No notice");
    act(() => {
      client.dismissToast(toast.id);
    });
    fireEvent.keyDown(window, { key: "1" });
    expect(toastsOf(client, HIDDEN_GROUP)).toHaveLength(1);
    expect(sentFrom(transport, before)).toEqual([]);
  });

  it("negative check: with the eye of the other layer off, the note is written without a notice", () => {
    const { client, transport } = mountGame();
    click(cellButton(2, 2));
    click(button("Notas"));
    click(eye("group"));
    fireEvent.keyDown(window, { key: "1" });
    expect(transport.last("note.add")?.payload).toEqual({ layer: "personal", cell: 10, digit: 1 });
    expect(client.getState().toasts).toEqual([]);
  });

  it("negative check: without an editable cell there is no notice", () => {
    const { client } = mountGame();
    click(button("Notas"));
    click(eye("personal"));
    fireEvent.keyDown(window, { key: "1" });
    expect(client.getState().toasts).toEqual([]);
  });

  it("negative check: placing a number does not depend on the eyes", () => {
    const { client, transport } = mountGame();
    click(cellButton(2, 2));
    click(eye("personal"));
    click(eye("group"));
    fireEvent.keyDown(window, { key: "1" });
    expect(transport.last("cell.place")?.payload).toEqual({ cell: 10, digit: 1 });
    expect(client.getState().toasts).toEqual([]);
  });

  it("negative check: undo still works on a note of a hidden layer (D4)", () => {
    const { client, transport } = mountGame();
    writeNote(client, transport, "personal", 10, 1);
    click(eye("personal"));
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(transport.last("note.undo")).toBeDefined();
    expect(client.getState().toasts).toEqual([]);
  });
});

describe("T-42.17 with the preference off and the group eye off, a note is not written", () => {
  it("the key sends nothing and shows the notice of the group layer", () => {
    const { client, transport } = mountGame();
    click(cellButton(2, 2));
    click(button("Notas"));
    setPreference(false);
    click(eye("group"));
    const before = transport.sent.length;
    fireEvent.keyDown(window, { key: "1" });
    expect(sentFrom(transport, before)).toEqual([]);
    expect(toastsOf(client, HIDDEN_GROUP)).toHaveLength(1);
    expect(toastsOf(client, HIDDEN_PERSONAL)).toHaveLength(0);
  });

  it("negative check: with the group eye on and visible.personal false, it writes in group, no notice", () => {
    const { client, transport } = mountGame();
    click(cellButton(2, 2));
    click(button("Notas"));
    click(eye("personal"));
    expect(client.getState().visible.personal).toBe(false);
    setPreference(false);
    fireEvent.keyDown(window, { key: "1" });
    expect(transport.last("note.add")?.payload).toEqual({ layer: "group", cell: 10, digit: 1 });
    expect(client.getState().toasts).toEqual([]);
  });
});

describe("T-42.18 «Borrar», Supr and Retroceso with the write layer hidden", () => {
  it("with the eye of the active layer off, they remove nothing and show the same notice", () => {
    const { client, transport } = mountGame();
    writeNote(client, transport, "personal", 10, 1);
    click(eye("personal"));
    const before = transport.sent.length;
    click(button(/^Borrar las notas/));
    deleteKeys();
    expect(sentFrom(transport, before)).toEqual([]);
    expect(toastsOf(client, HIDDEN_PERSONAL)).toHaveLength(1);
  });

  it("with the preference off and the group eye off, they remove nothing and show the same notice", () => {
    const { client, transport } = mountGame();
    writeNote(client, transport, "group", 10, 1);
    setPreference(false);
    click(eye("group"));
    const before = transport.sent.length;
    click(button(/^Borrar las notas/));
    deleteKeys();
    expect(sentFrom(transport, before)).toEqual([]);
    expect(toastsOf(client, HIDDEN_GROUP)).toHaveLength(1);
  });

  it("the notice appears even if the hidden layer has no notes there", () => {
    const { client, transport } = mountGame();
    click(cellButton(2, 2));
    click(eye("personal"));
    const before = transport.sent.length;
    fireEvent.keyDown(window, { key: "Delete" });
    expect(sentFrom(transport, before)).toEqual([]);
    expect(toastsOf(client, HIDDEN_PERSONAL)).toHaveLength(1);
  });

  it("negative check: with the layer visible, «Borrar» sends note.remove and there is no notice", () => {
    const { client, transport } = mountGame();
    writeNote(client, transport, "personal", 10, 1);
    click(button(/^Borrar las notas/));
    expect(transport.last("note.remove")?.payload).toEqual({
      layer: "personal",
      cell: 10,
      digit: 1,
    });
    expect(client.getState().toasts).toEqual([]);
  });

  it("negative check: with «Usar notas» off, nothing is sent and there is no notice", () => {
    const { client, transport } = mountGame({ prefs: memoryPrefs({ [USE_NOTES_KEY]: "0" }) });
    click(cellButton(2, 2));
    act(() => {
      client.toggleVisible("personal");
    });
    const before = transport.sent.length;
    deleteKeys();
    expect(sentFrom(transport, before)).toEqual([]);
    expect(client.getState().toasts).toEqual([]);
  });

  describe.each([
    ["the eye of the active layer off", false],
    ["the preference off and the group eye off", true],
  ])("negative check: with a digit in the cell, and %s", (_name, preferenceOff) => {
    const hideWriteLayer = (client: GameClient) => {
      act(() => {
        if (preferenceOff) {
          client.setPersonalNotesEnabled(false);
          client.toggleVisible("group");
        } else {
          client.toggleVisible("personal");
        }
      });
    };

    it("Supr and Retroceso do nothing on a given digit", () => {
      const { client, transport } = mountGame();
      hideWriteLayer(client);
      click(cellButton(1, 1));
      const before = transport.sent.length;
      deleteKeys();
      expect(sentFrom(transport, before)).toEqual([]);
      expect(client.getState().toasts).toEqual([]);
      expect(cellButton(1, 1).getAttribute("aria-label")).toMatch(/5/);
      expect(client.getState().locked[0]?.value).toBe(5);
    });

    it("Supr and Retroceso do nothing on a correct digit", () => {
      const { client, transport } = mountGame();
      transport.emit({
        type: "cell.solved",
        seq: 2,
        payload: { cell: 10, value: 7, by: ME.id, points: 10, score: 10, bonuses: [] },
      });
      hideWriteLayer(client);
      click(cellButton(2, 2));
      const before = transport.sent.length;
      deleteKeys();
      expect(sentFrom(transport, before)).toEqual([]);
      expect(client.getState().toasts).toEqual([]);
      expect(client.getState().locked[10]?.value).toBe(7);
    });

    it("Supr and Retroceso do nothing on a pending digit", () => {
      const { client, transport } = mountGame();
      hideWriteLayer(client);
      click(cellButton(2, 2));
      fireEvent.keyDown(window, { key: "4" });
      expect(client.getState().pending.get(10)?.digit).toBe(4);
      const before = transport.sent.length;
      deleteKeys();
      expect(sentFrom(transport, before)).toEqual([]);
      expect(client.getState().toasts).toEqual([]);
      expect(client.getState().pending.get(10)?.digit).toBe(4);
    });

    it("a wrong digit in its flash is an empty cell: Supr shows the notice and sends nothing", () => {
      const { client, transport } = mountGame();
      hideWriteLayer(client);
      click(cellButton(2, 2));
      transport.emit({
        type: "cell.mistake",
        seq: 2,
        payload: {
          cell: 10,
          digit: 3,
          by: ME.id,
          points: -90,
          score: -90,
          livesLeft: 2,
          role: "active",
        },
      });
      expect(gridCell(2, 2).classList.contains("err")).toBe(true);
      const toasts = client.getState().toasts.length;
      const before = transport.sent.length;
      fireEvent.keyDown(window, { key: "Delete" });
      expect(sentFrom(transport, before)).toEqual([]);
      expect(client.getState().toasts).toHaveLength(toasts + 1);
      expect(client.getState().toasts.at(-1)?.text).toBe(
        preferenceOff ? HIDDEN_GROUP : HIDDEN_PERSONAL,
      );
    });
  });
});
