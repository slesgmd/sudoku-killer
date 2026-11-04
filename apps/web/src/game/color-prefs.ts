// Colores personales (SPEC, R-42): una preferencia local que se guarda solo en este navegador y no
// viaja por el protocolo. Cualquier valor que no se entienda vuelve a Predeterminado, sin errores.
import { z } from "zod";
import type { Prefs } from "./prefs.ts";

export const COLORS_KEY = "sk:pref:colors";

/** Cuántos colores tiene la paleta (`--pal-1` a `--pal-9` en tokens.css). */
export const PALETTE_SIZE = 9;

/** 0 es Predeterminado; de 1 a 9, un color de la paleta. */
const colorOption = z.int().min(0).max(PALETTE_SIZE);

const colorPrefsSchema = z.strictObject({
  version: z.literal(1),
  /** Aleatorio: un color por jaula (R-43). Jaula y Suma conservan lo elegido mientras está activo. */
  random: z.boolean(),
  cage: colorOption,
  sum: colorOption,
  personal: colorOption,
  group: colorOption,
});

export type ColorPrefs = z.infer<typeof colorPrefsSchema>;

/** Lo que el jugador puede cambiar. */
export type ColorChange = Partial<Omit<ColorPrefs, "version">>;

export const DEFAULT_COLORS: ColorPrefs = {
  version: 1,
  random: false,
  cage: 0,
  sum: 0,
  personal: 0,
  group: 0,
};

export function loadColors(prefs: Prefs): ColorPrefs {
  try {
    const stored = prefs.get(COLORS_KEY);
    if (stored === null) return DEFAULT_COLORS;
    const parsed = colorPrefsSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : DEFAULT_COLORS;
  } catch {
    return DEFAULT_COLORS;
  }
}

export function saveColors(prefs: Prefs, colors: ColorPrefs): void {
  try {
    prefs.set(COLORS_KEY, JSON.stringify(colors));
  } catch {
    // Sin almacenamiento: la preferencia dura hasta recargar.
  }
}
