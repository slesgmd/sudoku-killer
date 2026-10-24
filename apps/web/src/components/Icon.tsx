// Iconos de trazo de 16 × 16 (docs/diseno.md §4), dibujados para el juego, en `currentColor`.
const PATHS = {
  time: (
    <>
      <circle cx="8" cy="8.5" r="5.5" />
      <path d="M8 5.5v3l2 1.5M6.5 1.5h3" />
    </>
  ),
  hint: (
    <path d="M6 12.5h4M6.5 14.5h3M8 1.5a4.5 4.5 0 0 0-2.7 8.1c.5.4.7.9.7 1.4h4c0-.5.2-1 .7-1.4A4.5 4.5 0 0 0 8 1.5z" />
  ),
  leave: <path d="M6.5 2.5h-3v11h3M10 5l3 3-3 3M13 8H6" />,
  eye: (
    <>
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <path d="M2.5 2.5l11 11" />
    </>
  ),
  erase: <path d="M6 13.5h8M2.8 9.8l6-6 3.4 3.4-6.3 6.3H4.5z" />,
  undo: (
    <>
      <path d="M5 3 2 6l3 3" />
      <path d="M2 6h7.5a4 4 0 0 1 0 8H7" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 7.5v4M8 4.8v.2" />
    </>
  ),
  alert: (
    <>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5v4.5M8 11.2v.2" />
    </>
  ),
  list: <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.5M2.5 8h.5M2.5 12h.5" />,
  chevron: <path d="M4 6l4 4 4-4" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  check: <path d="M3 8.5l3 3 7-7" />,
} as const;

export type IconName = keyof typeof PATHS | "dots";

export function Icon({ name, label }: { readonly name: IconName; readonly label?: string }) {
  const a11y = label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label };
  if (name === "dots") {
    return (
      <svg viewBox="0 0 16 16" fill="currentColor" {...a11y}>
        <circle cx="3" cy="8" r="1.4" />
        <circle cx="8" cy="8" r="1.4" />
        <circle cx="13" cy="8" r="1.4" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...a11y}
    >
      {PATHS[name]}
    </svg>
  );
}

const HEART = "M8 14 2.6 8.8A3.3 3.3 0 0 1 8 4.4a3.3 3.3 0 0 1 5.4 4.4z";

/** Tres corazones: llenos en ink, vacíos con trazo muted (§5.5). */
export function Hearts({ lives, total }: { readonly lives: number; readonly total: number }) {
  return (
    <span className="hearts" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <svg key={i} viewBox="0 0 16 16">
          <path d={HEART} className={i < lives ? "heart-full" : "heart-empty"} />
        </svg>
      ))}
    </span>
  );
}

/**
 * Marca de GitHub (Invertocat) para el enlace al repositorio del inicio. Según las pautas de uso del
 * logo de GitHub: la forma sin cambios, de un solo color (ink, el negro de la paleta) y a 20 px, por
 * encima del mínimo de 16 px. SVG local, sin CDN.
 */
export function GitHubMark() {
  return (
    <svg className="ghmark" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
