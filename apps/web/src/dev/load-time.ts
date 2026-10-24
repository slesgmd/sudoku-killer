// Último tiempo de carga de un puzzle en el servidor simulado (solo desarrollo): lo muestra
// `LoadBadge` en pantalla, para verlo en el celular sin la consola.
export interface LoadTime {
  readonly ms: number;
  readonly difficulty: string;
  readonly seed: number;
}

let last: LoadTime | null = null;
const listeners = new Set<() => void>();

export function reportLoadTime(value: LoadTime): void {
  last = value;
  for (const listener of [...listeners]) listener();
}

export function lastLoadTime(): LoadTime | null {
  return last;
}

export function subscribeLoadTime(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
