// Interruptor de Ajustes (docs/diseno.md §5.8): etiqueta, ayuda y «Sí» / «No» bajo la pista.
import type { RefObject } from "react";
import { t } from "../i18n/index.ts";

export function Switch({
  label,
  help,
  checked,
  onChange,
  disabled = false,
  switchRef,
}: {
  readonly label: string;
  readonly help: string;
  readonly checked: boolean;
  readonly onChange: (value: boolean) => void;
  /** Conserva su valor y no se puede cambiar. */
  readonly disabled?: boolean;
  readonly switchRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={switchRef}
      className="switch"
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled ? "true" : undefined}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
    >
      <span className="stext">
        <span className="slabel">{label}</span>
        <span className="shelp">{help}</span>
      </span>
      <span className="sside" aria-hidden="true">
        <span className="track" />
        <span className="sstate">{checked ? t("settings.on") : t("settings.off")}</span>
      </span>
    </button>
  );
}
