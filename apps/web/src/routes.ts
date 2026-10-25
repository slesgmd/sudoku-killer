// Rutas por hash (F10, design/pantallas.md): Inicio, Entrar o crear, la sala y Ayuda. La sala tiene
// una sola ruta, `#/sala/CODIGO`: el lobby, la partida o Resultados salen del estado de la sala
// (decisión 3). La ficha nunca va en la URL (SPEC §2.4): el enlace solo lleva el código. El enlace de
// invitación del grupo (`#k=CLAVE`, R-39) es aparte: la clave sale de la URL al abrirlo y se guarda
// solo si `POST /access` dice que vale (T-39.14).
import { isRoomCodeShape, isValidAccessKey, normalizeAccessKey } from "@sudoku-killer/protocol";
import { useSyncExternalStore } from "react";

export type Route =
  | { readonly name: "home" }
  | { readonly name: "enter"; readonly code: string | null }
  | { readonly name: "room"; readonly code: string }
  | { readonly name: "help" };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [head, code] = parts;
  if (head === "entrar")
    return { name: "enter", code: code && isRoomCodeShape(code) ? code.toUpperCase() : null };
  if (head === "sala" && code && isRoomCodeShape(code))
    return { name: "room", code: code.toUpperCase() };
  if (head === "ayuda") return { name: "help" };
  return { name: "home" };
}

export function routeHash(route: Route): string {
  switch (route.name) {
    case "home":
      return "#/";
    case "enter":
      return route.code === null ? "#/entrar" : `#/entrar/${route.code}`;
    case "room":
      return `#/sala/${route.code}`;
    case "help":
      return "#/ayuda";
  }
}

/** El enlace para invitar a la sala: el mismo origen y ruta, con `#/sala/CODIGO`. */
export function roomLink(code: string, location: Pick<Location, "origin" | "pathname" | "search">) {
  return `${location.origin}${location.pathname}${location.search}${routeHash({ name: "room", code })}`;
}

/** La clave de un enlace de invitación (`#k=…`), normalizada, o `null` si no es una válida. */
export function invitationKey(hash: string): string | null {
  if (!hash.startsWith("#k=")) return null;
  try {
    const key = normalizeAccessKey(decodeURIComponent(hash.slice(3)));
    return isValidAccessKey(key) ? key : null;
  } catch {
    return null;
  }
}

/**
 * Al abrir un enlace de invitación (R-39): entrega la clave a `take` (que la comprueba antes de
 * guardarla, T-39.14) y la saca de la URL y del historial (reemplaza la entrada por `#/`), aunque no
 * sea una clave válida. Devuelve si había invitación.
 */
export function takeInvitation(
  location: Pick<Location, "hash" | "pathname" | "search">,
  history: Pick<History, "replaceState">,
  take: (key: string) => void,
): boolean {
  if (!location.hash.startsWith("#k=")) return false;
  const key = invitationKey(location.hash);
  if (key !== null) take(key);
  history.replaceState(null, "", `${location.pathname}${location.search}#/`);
  return true;
}

/**
 * Va a una ruta: con `replace`, sin agregar una entrada al historial. El aviso `hashchange` sale en
 * el momento (con `location.hash` llegaría después); «Atrás» y los enlaces lo emiten solos.
 */
export function navigate(route: Route, { replace = false }: { replace?: boolean } = {}): void {
  const hash = routeHash(route);
  if (window.location.hash === hash) return;
  if (replace) window.history.replaceState(window.history.state, "", hash);
  else window.history.pushState(null, "", hash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
  };
}

const currentHash = () => window.location.hash;

/** El hash actual: se lee del documento en cada render, nunca de un estado viejo. */
export function useHash(): string {
  return useSyncExternalStore(subscribe, currentHash);
}
