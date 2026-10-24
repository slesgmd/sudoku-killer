// Indicador de desarrollo: «carga: N ms» en una esquina, con el tiempo de la última carga de puzzle
// del servidor simulado. Solo existe en desarrollo (App lo importa bajo `import.meta.env.DEV`).
import { useSyncExternalStore } from "react";
import { lastLoadTime, subscribeLoadTime } from "./load-time.ts";

export default function LoadBadge() {
  const load = useSyncExternalStore(subscribeLoadTime, lastLoadTime);
  if (!load) return null;
  return (
    <div
      aria-hidden="true"
      title={`${load.difficulty} · seed ${String(load.seed)}`}
      style={{
        position: "fixed",
        left: "var(--s-1)",
        bottom: "var(--s-1)",
        zIndex: 100,
        padding: "2px 6px",
        borderRadius: "var(--r-sm)",
        background: "var(--paper)",
        border: "var(--bw) dashed var(--muted)",
        color: "var(--muted)",
        fontSize: "11px",
        lineHeight: "14px",
        pointerEvents: "none",
      }}
    >
      {`carga: ${load.ms.toFixed(0)} ms`}
    </div>
  );
}
