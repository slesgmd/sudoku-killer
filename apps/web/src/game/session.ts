// Sesión guardada en este navegador (SPEC §2.4): la ficha de reconexión de cada sala, en
// `sk:token:<code>`, el último apodo, la última sala y la clave de acceso del grupo (`sk:access`,
// R-39), que solo sale de aquí hacia el servidor, en `POST /access` y en el handshake del
// WebSocket, y solo se guarda después de que `POST /access` la aceptó. La ficha solo sale de aquí hacia el servidor,
// en `room.join`: nunca va a la URL, a un log, al estado de la interfaz ni a otros jugadores. Si el
// almacenamiento no está disponible (modo privado estricto), la sesión dura lo que la página.
export interface SessionStore {
  token(code: string): string | null;
  saveToken(code: string, token: string): void;
  forgetToken(code: string): void;
  nickname(): string | null;
  saveNickname(nickname: string): void;
  /** La última sala en la que se entró (para «Volver a la sala»). */
  lastRoom(): string | null;
  saveLastRoom(code: string | null): void;
  /** La clave de acceso del grupo, normalizada (R-39). */
  accessKey(): string | null;
  saveAccessKey(key: string | null): void;
}

/** Lo que se usa de `localStorage`. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const TOKEN_PREFIX = "sk:token:";
const NICKNAME_KEY = "sk:nickname";
const LAST_ROOM_KEY = "sk:lastRoom";
export const ACCESS_KEY = "sk:access";

function storageSession(storage: () => KeyValueStorage | undefined): SessionStore {
  const memory = new Map<string, string>();
  const get = (key: string): string | null => {
    try {
      const store = storage();
      if (store) return store.getItem(key);
    } catch {
      // Sin almacenamiento: se usa la memoria.
    }
    return memory.get(key) ?? null;
  };
  const set = (key: string, value: string | null) => {
    if (value === null) memory.delete(key);
    else memory.set(key, value);
    try {
      const store = storage();
      if (!store) return;
      if (value === null) store.removeItem(key);
      else store.setItem(key, value);
    } catch {
      // Sin almacenamiento: queda en la memoria.
    }
  };
  const tokenKey = (code: string) => `${TOKEN_PREFIX}${code.toUpperCase()}`;
  return {
    token: (code) => get(tokenKey(code)),
    saveToken: (code, token) => {
      set(tokenKey(code), token);
    },
    forgetToken: (code) => {
      set(tokenKey(code), null);
    },
    nickname: () => get(NICKNAME_KEY),
    saveNickname: (nickname) => {
      set(NICKNAME_KEY, nickname);
    },
    lastRoom: () => get(LAST_ROOM_KEY),
    saveLastRoom: (code) => {
      set(LAST_ROOM_KEY, code);
    },
    accessKey: () => get(ACCESS_KEY),
    saveAccessKey: (key) => {
      set(ACCESS_KEY, key);
    },
  };
}

export const browserSession: SessionStore = storageSession(() => globalThis.localStorage);

/** Sesión en memoria (pruebas y bots). */
export function memorySession(): SessionStore {
  return storageSession(() => undefined);
}
