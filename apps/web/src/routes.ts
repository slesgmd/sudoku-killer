// Rutas por hash (F10, design/pantallas.md): Inicio, Entrar o crear, la sala y Ayuda. La sala tiene
// una sola ruta, `#/sala/CODIGO`: el lobby, la partida o Resultados salen del estado de la sala
// (decisión 3). La ficha nunca va en la URL (SPEC §2.4): el enlace solo lleva el código.
import { isRoomCodeShape } from "@sudoku-killer/protocol";
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
