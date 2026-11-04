// Colores personales: lo guardado se valida al leerlo y, si no se entiende, vuelve a Predeterminado.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COLORS_KEY,
  DEFAULT_COLORS,
  loadColors,
  saveColors,
  type ColorPrefs,
} from "../src/game/color-prefs.ts";
import { browserPrefs, memoryPrefs, type Prefs } from "../src/game/prefs.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const stored = (value: string) => memoryPrefs({ [COLORS_KEY]: value });

const VALID: ColorPrefs = { version: 1, random: true, cage: 1, sum: 9, personal: 4, group: 0 };

describe("T-42.1 stored colours are validated when read", () => {
  it.each([
    ["corrupt JSON", "{not json"],
    ["a value of another type", "7"],
    ["null", "null"],
    ["an unknown version", JSON.stringify({ ...VALID, version: 2 })],
    ["a colour above the palette", JSON.stringify({ ...VALID, cage: 10 })],
    ["a negative colour", JSON.stringify({ ...VALID, sum: -1 })],
    ["a fractional colour", JSON.stringify({ ...VALID, group: 1.5 })],
    ["a colour by name", JSON.stringify({ ...VALID, personal: "vino" })],
    ["a missing field", JSON.stringify({ version: 1, random: false, cage: 0, sum: 0, group: 0 })],
    ["an unknown field", JSON.stringify({ ...VALID, chat: 1 })],
  ])("%s falls back to Predeterminado without throwing", (_name, value) => {
    expect(loadColors(stored(value))).toEqual(DEFAULT_COLORS);
  });

  it("nothing stored is Predeterminado", () => {
    expect(loadColors(memoryPrefs())).toEqual(DEFAULT_COLORS);
  });

  it("a storage that throws, on reading or on writing, does not throw", () => {
    const broken: Prefs = {
      get() {
        throw new Error("denied");
      },
      set() {
        throw new Error("denied");
      },
    };
    expect(loadColors(broken)).toEqual(DEFAULT_COLORS);
    expect(() => {
      saveColors(broken, VALID);
    }).not.toThrow();
  });

  it("the browser storage without access does not throw either", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    });
    expect(loadColors(browserPrefs)).toEqual(DEFAULT_COLORS);
    expect(() => {
      saveColors(browserPrefs, VALID);
    }).not.toThrow();
  });

  it("negative check: a valid value is kept, also after saving it", () => {
    expect(loadColors(stored(JSON.stringify(VALID)))).toEqual(VALID);
    const prefs = memoryPrefs();
    saveColors(prefs, VALID);
    expect(loadColors(prefs)).toEqual(VALID);
  });
});
