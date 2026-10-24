// Disposición de la pantalla de partida (docs/diseno.md §8). La distribución la hacen las media
// queries de game.css; esto decide qué componentes se dibujan (lista o franja, lupa, menú «⋯»).
import { useSyncExternalStore } from "react";

export type Layout = "desktop" | "tablet" | "mobile" | "landscape";

const QUERIES: readonly (readonly [Layout, string])[] = [
  ["landscape", "(max-height: 479px) and (orientation: landscape)"],
  ["desktop", "(min-width: 1024px)"],
  ["tablet", "(min-width: 600px)"],
];

function current(): Layout {
  if (typeof window.matchMedia !== "function") return "desktop";
  for (const [layout, query] of QUERIES) {
    if (window.matchMedia(query).matches) return layout;
  }
  return "mobile";
}

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const lists = QUERIES.map(([, query]) => window.matchMedia(query));
  for (const list of lists) list.addEventListener("change", onChange);
  return () => {
    for (const list of lists) list.removeEventListener("change", onChange);
  };
}

export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, current);
}
