// Diálogo modal (docs/diseno.md §5.7): foco atrapado, Esc cancela cuando hay cancelar, foco inicial
// en el control que se indica (la acción segura) y, al cerrar, vuelta al control que lo abrió.
import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
  /** Botón de cerrar en la cabecera (Ajustes). */
  readonly closeLabel?: string;
  /** Con cancelar: Esc lo llama. Sin él, el diálogo es bloqueante. */
  readonly onCancel?: () => void;
  /** Control que recibe el foco al abrir. */
  readonly initialFocus: RefObject<HTMLElement | null>;
  readonly role?: "dialog" | "alertdialog";
}

export function Dialog({
  title,
  children,
  actions,
  closeLabel,
  onCancel,
  initialFocus,
  role = "dialog",
}: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    initialFocus.current?.focus();
    return () => {
      opener?.focus();
    };
  }, [initialFocus]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="scrim" onKeyDown={onKeyDown}>
      <div
        ref={panel}
        className="dialog"
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <div className="dhead">
          <h2 id={titleId}>{title}</h2>
          {closeLabel && onCancel ? (
            <button className="btn ghost" type="button" aria-label={closeLabel} onClick={onCancel}>
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          ) : null}
        </div>
        <div id={bodyId} className="dbody">
          {children}
        </div>
        {actions ? <div className="dactions">{actions}</div> : null}
      </div>
    </div>
  );
}
