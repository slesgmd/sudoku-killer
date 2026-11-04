// Cuenta atrás de una espera (R-40): «0:27». La lee quien mira la pantalla; un lector de pantalla oye
// el aviso una vez, sin que cada segundo lo interrumpa (`aria-live="off"`, como el cronómetro).
import { useCallback, useSyncExternalStore } from "react";

/** Segundos que faltan para `until` (hora de este dispositivo), redondeando hacia arriba. */
export function useSecondsLeft(until: number): number {
  const read = useCallback(() => Math.max(0, Math.ceil((until - Date.now()) / 1000)), [until]);
  const subscribe = useCallback(
    (changed: () => void) => {
      if (read() === 0) return () => undefined;
      const timer = setInterval(changed, 1000);
      return () => {
        clearInterval(timer);
      };
    },
    [read],
  );
  return useSyncExternalStore(subscribe, read);
}

/** «4:05». */
export function formatWait(seconds: number): string {
  const rest = seconds % 60;
  return `${String(Math.floor(seconds / 60))}:${rest < 10 ? "0" : ""}${String(rest)}`;
}

export function Countdown({ until }: { readonly until: number }) {
  const seconds = useSecondsLeft(until);
  return (
    <span className="tnum" role="timer" aria-live="off">
      {formatWait(seconds)}
    </span>
  );
}
