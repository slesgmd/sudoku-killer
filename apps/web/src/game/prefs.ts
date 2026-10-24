// Preferencias locales del cliente: se guardan solo en este navegador (localStorage), no viajan por
// el protocolo ni dependen del servidor (SPEC, R-06, «Usar notas»). Si el almacenamiento no está
// disponible (modo privado, pruebas), se usan los valores por defecto.
export interface Prefs {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** «Usar notas»: "1" o "0"; activado por defecto. */
export const USE_NOTES_KEY = "sk:pref:useNotes";

export const browserPrefs: Prefs = {
  get(key) {
    try {
      return globalThis.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      globalThis.localStorage.setItem(key, value);
    } catch {
      // Sin almacenamiento: la preferencia dura hasta recargar.
    }
  },
};

/** Preferencias en memoria (pruebas). */
export function memoryPrefs(initial: Readonly<Record<string, string>> = {}): Prefs {
  const values = new Map(Object.entries(initial));
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, value);
    },
  };
}
